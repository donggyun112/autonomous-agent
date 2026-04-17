import { config } from "dotenv";
config();

import OpenAI from "openai";
import { createHash } from "crypto";

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const LOCAL_EMBEDDING_MODEL =
  process.env.LOCAL_EMBEDDING_MODEL ?? "paraphrase-multilingual-MiniLM-L12-v2";

const _DEFAULT_BACKEND = OPENAI_API_KEY ? "openai" : "local";
export const EMBEDDING_BACKEND =
  process.env.EMBEDDING_BACKEND ?? _DEFAULT_BACKEND;

const EMBED_RETRIES = 3;
const HASH_DIM = 384; // dimension for hash-based fallback embeddings

let _openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  }
  return _openaiClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _localModel: any = null;
let _localFailed = false;

async function getLocalModel() {
  if (_localFailed) return null;
  if (!_localModel) {
    try {
      // @ts-ignore — optional dependency
      const transformers = await import("@xenova/transformers");
      _localModel = await transformers.pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL);
    } catch {
      _localFailed = true;
      console.warn("[embedding] @xenova/transformers not available, falling back to hash-based embeddings");
      return null;
    }
  }
  return _localModel;
}

// Deterministic hash-based pseudo-embedding. Not semantic — just consistent
// vectors so memory graph operations (dedup, link) still work with cosine sim.
function hashEmbed(text: string): number[] {
  const vec = new Float64Array(HASH_DIM);
  // Use overlapping character n-grams hashed into buckets
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.slice(i, i + 3);
    const h = parseInt(createHash("md5").update(trigram).digest("hex").slice(0, 8), 16);
    const bucket = h % HASH_DIM;
    vec[bucket] += 1;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < HASH_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

async function embedLocal(text: string): Promise<number[]> {
  const model = await getLocalModel();
  if (!model) return hashEmbed(text);
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data[0]) as number[];
}

export async function embedTextAsync(text: string): Promise<number[]> {
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
        // Final fallback: hash-based embedding instead of crashing
        console.warn("[embedding] OpenAI failed after retries, using hash fallback:", (err as Error).message);
        return hashEmbed(text);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
  throw new Error("unreachable");
}
