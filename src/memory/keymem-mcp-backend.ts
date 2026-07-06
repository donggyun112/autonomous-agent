import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { MemoryBackend, MemoryRecord } from "./backend.js";

type JsonObject = Record<string, unknown>;

type RpcResponse = {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type Pending = {
  resolve: (value: RpcResponse) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

function parseArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return ["-y", "keymem"];
  return raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) =>
    part.replace(/^["']|["']$/g, ""),
  ) ?? [];
}

function textFromToolResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const rec = item as { type?: unknown; text?: unknown };
      return rec.type === "text" && typeof rec.text === "string" ? rec.text : "";
    })
    .join("");
}

function parseToolJson(result: unknown): unknown {
  const text = textFromToolResult(result);
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeKeys(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  // list_memories returns keys as strings; recall(inject) returns them as
  // { concept, key_id } objects. Normalize both to concept strings.
  return value.map((k) =>
    typeof k === "string" ? k : String((k as { concept?: unknown })?.concept ?? k),
  );
}

function normalizeMemory(item: unknown): MemoryRecord {
  const rec = item && typeof item === "object" ? item as JsonObject : {};
  const id = String(rec.id ?? rec.memory_id ?? rec.saved ?? "");
  const content = String(rec.content ?? rec.text ?? rec.memory ?? "");
  return {
    ...rec,
    id,
    content,
    depth: typeof rec.depth === "number" ? rec.depth : undefined,
    access_count: typeof rec.access_count === "number" ? rec.access_count : undefined,
    created_at: typeof rec.created_at === "number" ? rec.created_at : undefined,
    keys: normalizeKeys(rec.keys),
    source: rec.source && typeof rec.source === "object" ? rec.source as Record<string, unknown> : null,
    namespace: typeof rec.namespace === "string" ? rec.namespace : undefined,
    links: Array.isArray(rec.links) ? rec.links.map(String) : undefined,
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = Buffer.alloc(0);
  private initialized: Promise<void> | null = null;

  async callTool(name: string, args: JsonObject): Promise<unknown> {
    await this.init();
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error) throw new Error(response.error.message ?? `KeyMem tool failed: ${name}`);
    return parseToolJson(response.result);
  }

  stop(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("KeyMem MCP client stopped"));
    }
    this.pending.clear();
    this.child?.kill();
    this.child = null;
    this.initialized = null;
  }

  private async init(): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = this.start().catch((err) => {
      // Don't cache a rejected initialize forever — allow the next call to retry.
      this.initialized = null;
      throw err;
    });
    return this.initialized;
  }

  private async start(): Promise<void> {
    const command = process.env.KEYMEM_COMMAND?.trim() || "npx";
    const args = parseArgs(process.env.KEYMEM_ARGS);
    const env = {
      ...process.env,
      KEYMEM_DIRECT_RECALL: process.env.KEYMEM_DIRECT_RECALL ?? "true",
      // KeyMem's default local model (fast-multilingual-e5-large) is frequently
      // an incomplete download (model.onnx missing), which makes `recall` fail
      // with "Failed to initialize local fastembed model". Match the known-good
      // MCP config and default to bge-m3. Any user-provided value still wins.
      EMBEDDING_BACKEND: process.env.EMBEDDING_BACKEND ?? "local",
      LOCAL_EMBEDDING_MODEL: process.env.LOCAL_EMBEDDING_MODEL ?? "bge-m3",
    };
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env });
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      if (process.env.KEYMEM_DEBUG === "1") process.stderr.write(chunk);
    });
    this.child.on("exit", (code, signal) => {
      const reason = `KeyMem MCP process exited (${code ?? signal ?? "unknown"})`;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(reason));
      }
      this.pending.clear();
      this.child = null;
      this.initialized = null;
    });

    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "autonomous-agent", version: "0.0.1" },
    });
    if (response.error) throw new Error(response.error.message ?? "KeyMem MCP initialize failed");
    this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }

  private request(method: string, params: JsonObject): Promise<RpcResponse> {
    const id = this.nextId++;
    const timeoutMs = Number(process.env.KEYMEM_MCP_TIMEOUT_MS ?? 120_000);
    const msg = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`KeyMem MCP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(msg);
    });
  }

  private send(message: JsonObject): void {
    // MCP stdio transport frames messages as newline-delimited JSON — NOT the
    // LSP-style Content-Length header. JSON.stringify never emits embedded
    // newlines, so a single trailing "\n" is a complete frame.
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const nl = this.buffer.indexOf(0x0a); // "\n"
      if (nl === -1) return;
      const line = this.buffer.slice(0, nl).toString("utf-8").trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let response: RpcResponse;
      try {
        response = JSON.parse(line) as RpcResponse;
      } catch {
        continue; // ignore any non-JSON line the server may emit on stdout
      }
      if (typeof response.id !== "number") continue;
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      pending.resolve(response);
    }
  }
}

const client = new McpStdioClient();

export function stopKeymemMcpBackend(): void {
  client.stop();
}

export const keymemMcpBackend: MemoryBackend = {
  id: "keymem",

  async recall(query, topK = 5) {
    // KeyMem's tool is `recall` (not `recall_memories`). Without inject it
    // returns only key clusters; inject:true additionally returns the connected
    // memories' content in `result.memories`, which is the record shape this
    // backend contract expects.
    const result = await client.callTool("recall", {
      query,
      top_k: topK,
      inject: true,
      inject_top_k: topK,
    });
    const memories = Array.isArray(result)
      ? result
      : (result as { memories?: unknown })?.memories;
    return asArray(memories).map(normalizeMemory);
  },

  async remember(content, keys, options) {
    const result = await client.callTool("remember", {
      content,
      keys,
      key_types: options?.keyTypes,
      namespace: options?.namespace,
      source: options?.source,
    });
    const rec = result && typeof result === "object" ? result as JsonObject : {};
    return {
      id: String(rec.saved ?? rec.new_id ?? rec.id ?? ""),
      deduped: rec.deduplicated === true,
    };
  },

  async recentMemories(limit = 20) {
    const result = await client.callTool("list_memories", {});
    return asArray(result)
      .map(normalizeMemory)
      .sort((a, b) => (Number(b.created_at ?? 0) - Number(a.created_at ?? 0)))
      .slice(0, limit);
  },

  async shallowMemories(maxDepth = 0.3, limit = 20) {
    const result = await client.callTool("list_memories", {});
    return asArray(result)
      .map(normalizeMemory)
      .filter((memory) => Number(memory.depth ?? 0) <= maxDepth)
      .slice(0, limit);
  },

  async dream(args) {
    const result = await client.callTool("correct", {
      memory_id: args.memoryId,
      content: args.compressedContent,
    });
    const rec = result && typeof result === "object" ? result as JsonObject : {};
    return {
      id: String(rec.new_id ?? rec.saved ?? args.memoryId),
      depth: 0,
      previousContent: "",
    };
  },

  async pruneWeak() {
    return [];
  },

  async deleteMemory(memoryId) {
    const result = await client.callTool("forget", { memory_id: memoryId });
    const rec = result && typeof result === "object" ? result as JsonObject : {};
    return rec.deleted === true;
  },

  async findClusters() {
    return [];
  },

  async pickRandomDistantPair() {
    return null;
  },

  async linkMemories() {
    throw new Error("KeyMem MCP backend does not support direct linking of existing memories; use related_to when remembering or correcting.");
  },

  async memoryStats() {
    const result = await client.callTool("memory_stats", {});
    const rec = result && typeof result === "object" ? result as JsonObject : {};
    const keyCount = Number(rec.keys ?? 0);
    const memoryCount = Number(rec.memories ?? 0);
    const linkCount = Number(rec.links ?? 0);
    const all = await this.shallowMemories(1.0, 10_000);
    const avgDepth = all.length ? all.reduce((sum, mem) => sum + Number(mem.depth ?? 0), 0) / all.length : 0;
    const avgContentLen = all.length ? all.reduce((sum, mem) => sum + mem.content.length, 0) / all.length : 0;
    return {
      keyCount,
      memoryCount,
      activeMemoryCount: memoryCount,
      linkCount,
      avgDepth,
      avgContentLen,
    };
  },
};
