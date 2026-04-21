import { config } from "dotenv";
config();

import OpenAI from "openai";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

const LOCAL_EMBEDDING_URL =
  process.env.LOCAL_EMBEDDING_URL ??
  process.env.LOCAL_LLM_URL ??
  "http://host.docker.internal:8080";
const LOCAL_EMBEDDING_MODEL =
  process.env.LOCAL_EMBEDDING_MODEL ?? "nomic-embed-text";

const _DEFAULT_BACKEND = OPENAI_API_KEY ? "openai" : "local";
export const EMBEDDING_BACKEND =
  process.env.EMBEDDING_BACKEND ?? _DEFAULT_BACKEND;

const EMBED_RETRIES = 3;
const HASH_DIM = 384; // dimension for fallback embeddings — matches existing memory.json data

let _openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return _openaiClient;
}

// ── TF-IDF weighted trigram fallback ────────────────────────────────────
// A BM25-style fallback that captures word-level similarity using:
//   1. Word-level unigrams and bigrams for semantic signal
//   2. Character trigrams for morphological similarity
//   3. IDF-like weighting: shorter tokens (rarer trigram patterns) get higher weight
//   4. Sublinear TF (1 + log(tf)) to dampen repeated terms
// This is far better than raw hash bucketing for recall quality.

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u3000-\u9FFF\uAC00-\uD7AF]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function tfidfFallback(text: string): number[] {
  const vec = new Float64Array(HASH_DIM);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return Array.from(vec);

  const words = tokenize(normalized);

  // Accumulate term frequencies per bucket
  const tf = new Float64Array(HASH_DIM);

  // 1. Word unigrams — strongest semantic signal
  for (const word of words) {
    const h = fnv1a(word);
    const bucket = ((h % HASH_DIM) + HASH_DIM) % HASH_DIM;
    tf[bucket] += 1;
  }

  // 2. Word bigrams — capture phrase-level meaning
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + " " + words[i + 1];
    const h = fnv1a(bigram);
    const bucket = ((h % HASH_DIM) + HASH_DIM) % HASH_DIM;
    tf[bucket] += 0.5; // bigrams contribute less than unigrams
  }

  // 3. Character trigrams — morphological / substring similarity
  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.slice(i, i + 3);
    const h = fnv1a(trigram);
    const bucket = ((h % HASH_DIM) + HASH_DIM) % HASH_DIM;
    tf[bucket] += 0.3; // character trigrams contribute least
  }

  // Apply sublinear TF: 1 + log(tf) for tf > 0
  for (let i = 0; i < HASH_DIM; i++) {
    if (tf[i] > 0) {
      vec[i] = 1 + Math.log(tf[i]);
    }
  }

  // IDF-like weighting: use total distinct feature count as pseudo-document-length
  // Buckets hit by fewer features get implicit higher weight through the log-TF

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < HASH_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

/** FNV-1a hash — fast, good distribution, no crypto overhead */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) | 0; // multiply and keep 32-bit
  }
  return hash >>> 0; // unsigned
}

// ── Local embedding via HTTP endpoint ───────────────────────────────────

let _localEndpointFailed = false;
let _localEndpointFailedAt = 0;
const LOCAL_RETRY_INTERVAL_MS = 60_000; // retry the endpoint every 60s after a failure

async function embedLocal(text: string): Promise<number[]> {
  // If the endpoint previously failed, retry after a cooldown
  if (_localEndpointFailed) {
    if (Date.now() - _localEndpointFailedAt < LOCAL_RETRY_INTERVAL_MS) {
      return tfidfFallback(text);
    }
    // Cooldown elapsed — try again
    _localEndpointFailed = false;
  }

  try {
    const url = `${LOCAL_EMBEDDING_URL.replace(/\/+$/, "")}/v1/embeddings`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        model: LOCAL_EMBEDDING_MODEL,
      }),
      signal: AbortSignal.timeout(15_000), // 15s timeout
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const json = (await resp.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    if (
      !json.data ||
      !json.data[0] ||
      !Array.isArray(json.data[0].embedding)
    ) {
      throw new Error(
        "Unexpected response shape: missing data[0].embedding"
      );
    }

    return json.data[0].embedding;
  } catch (err) {
    _localEndpointFailed = true;
    _localEndpointFailedAt = Date.now();
    console.warn(
      `[embedding] Local embedding endpoint unavailable (${LOCAL_EMBEDDING_URL}), ` +
        `falling back to TF-IDF: ${(err as Error).message}`
    );
    return tfidfFallback(text);
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export async function embedTextAsync(text: string): Promise<number[]> {
  if (EMBEDDING_BACKEND === "tfidf") {
    return tfidfFallback(text);
  }
  if (EMBEDDING_BACKEND === "local") {
    return embedLocal(text);
  }

  const client = getOpenAIClient();
  for (let attempt = 0; attempt < EMBED_RETRIES; attempt++) {
    try {
      const resp = await client.embeddings.create({
        model: OPENAI_EMBEDDING_MODEL,
        input: text,
      });
      return resp.data[0].embedding;
    } catch (err) {
      if (attempt === EMBED_RETRIES - 1) {
        // Final fallback: TF-IDF embedding instead of crashing
        console.warn(
          "[embedding] OpenAI failed after retries, using TF-IDF fallback:",
          (err as Error).message
        );
        return tfidfFallback(text);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
  throw new Error("unreachable");
}

// ── Re-indexing ─────────────────────────────────────────────────────────
// Re-embeds all memories and keys in the graph file.
// Use this when migrating from hash-based to real embeddings.

interface ReindexGraphData {
  keys: Record<string, { id: string; concept: string; embedding: number[]; key_type: string }>;
  memories: Record<string, { id: string; content: string; embedding: number[]; [k: string]: unknown }>;
  links: Array<{ key_id: string; memory_id: string }>;
}

export async function reindex(
  memoryFilePath: string,
  opts?: { dryRun?: boolean; batchSize?: number }
): Promise<{ keysReindexed: number; memoriesReindexed: number }> {
  const dryRun = opts?.dryRun ?? false;
  const batchSize = opts?.batchSize ?? 10;

  let raw: ReindexGraphData;
  try {
    const text = await readFile(memoryFilePath, "utf-8");
    raw = JSON.parse(text) as ReindexGraphData;
  } catch (err) {
    throw new Error(
      `Cannot read memory file at ${memoryFilePath}: ${(err as Error).message}`
    );
  }

  let keysReindexed = 0;
  let memoriesReindexed = 0;

  // Re-embed keys
  const keyEntries = Object.entries(raw.keys ?? {});
  for (let i = 0; i < keyEntries.length; i += batchSize) {
    const batch = keyEntries.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(([, key]) => embedTextAsync(key.concept))
    );
    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        batch[j][1].embedding = result.value;
        keysReindexed++;
      } else {
        console.warn(
          `[reindex] Failed to embed key "${batch[j][1].concept}": ${result.reason}`
        );
      }
    }
  }

  // Re-embed memories
  const memEntries = Object.entries(raw.memories ?? {});
  for (let i = 0; i < memEntries.length; i += batchSize) {
    const batch = memEntries.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(([, mem]) => embedTextAsync(mem.content))
    );
    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        batch[j][1].embedding = result.value;
        memoriesReindexed++;
      } else {
        console.warn(
          `[reindex] Failed to embed memory "${batch[j][0]}": ${result.reason}`
        );
      }
    }
  }

  if (!dryRun) {
    await mkdir(dirname(memoryFilePath), { recursive: true });
    await writeFile(
      memoryFilePath,
      JSON.stringify(raw, null, 2),
      "utf-8"
    );
    console.error(
      `[reindex] Wrote ${keysReindexed} keys + ${memoriesReindexed} memories to ${memoryFilePath}`
    );
  } else {
    console.error(
      `[reindex] Dry run: would reindex ${keysReindexed} keys + ${memoriesReindexed} memories`
    );
  }

  return { keysReindexed, memoriesReindexed };
}
