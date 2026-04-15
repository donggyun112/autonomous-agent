import { readFile, writeFile, mkdir, appendFile } from "fs/promises";
import { randomBytes } from "crypto";
import { join, dirname } from "path";
import { Mutex } from "async-mutex";
import { embedTextAsync, EMBEDDING_BACKEND } from "./embedding.js";
import { MEMORY_FILE } from "../primitives/paths.js";
// Vendored from reference/super-memory.
// Modifications:
//  - DATA_DIR points at the agent's body (data/memory/)
//  - dream() method added (see end of file) for SLEEP-state consolidation
const DATA_DIR = dirname(MEMORY_FILE);
const GRAPH_FILE = MEMORY_FILE;
const CONVERSATIONS_DIR = join(DATA_DIR, "conversations");
const KEY_MERGE_THRESHOLD = 0.85;
const MEMORY_DEDUP_THRESHOLD = 0.85;
const KEY_AUTO_LINK_THRESHOLD = 0.5;
const KEY_RECALL_THRESHOLD = 0.28;
const CONTENT_RECALL_THRESHOLD = 0.28;
const DEPTH_INCREMENT = 0.05;
const DEPTH_MAX = 1.0;
const DEPTH_DEEP_THRESHOLD = 0.7;
// ── Vector math ──
function cosineSim(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const norm = Math.sqrt(normA) * Math.sqrt(normB);
    return norm === 0 ? 0 : dot / norm;
}
function batchCosineSim(query, matrix) {
    if (matrix.length === 0)
        return [];
    return matrix.map((row) => cosineSim(query, row));
}
// ── Utils ──
function uid() {
    return randomBytes(6).toString("hex");
}
export function sanitizeKeys(keys) {
    let arr;
    if (typeof keys === "string") {
        try {
            arr = JSON.parse(keys);
        }
        catch {
            arr = [keys];
        }
    }
    else if (Array.isArray(keys)) {
        arr = keys;
    }
    else {
        return [];
    }
    return arr
        .filter((k) => typeof k === "string" && k.trim().length >= 2)
        .map((k) => k.trim());
}
// ── MemoryGraph ──
export class MemoryGraph {
    keys = {};
    memories = {};
    _keyToMems = {};
    _memToKeys = {};
    _supersededBy = {};
    _storedDim = null;
    _lock = new Mutex();
    _dirty = false;
    static HOP_DECAY = 0.5;
    static TIME_HALF_LIFE = 30 * 24 * 3600;
    get linkCount() {
        return Object.values(this._keyToMems).reduce((sum, mids) => sum + mids.size, 0);
    }
    _link(keyId, memId) {
        if (!this._keyToMems[keyId])
            this._keyToMems[keyId] = new Set();
        this._keyToMems[keyId].add(memId);
        if (!this._memToKeys[memId])
            this._memToKeys[memId] = new Set();
        this._memToKeys[memId].add(keyId);
    }
    _hasLink(keyId, memId) {
        return this._keyToMems[keyId]?.has(memId) ?? false;
    }
    _unlinkMemory(memId) {
        const kids = this._memToKeys[memId];
        if (kids) {
            for (const kid of kids) {
                const mems = this._keyToMems[kid];
                if (mems) {
                    mems.delete(memId);
                    if (mems.size === 0)
                        delete this._keyToMems[kid];
                }
            }
            delete this._memToKeys[memId];
        }
    }
    _pruneOrphanKeys() {
        for (const kid of Object.keys(this.keys)) {
            const mems = this._keyToMems[kid];
            if (!mems || mems.size === 0)
                delete this.keys[kid];
        }
    }
    _checkDim(embedding) {
        const dim = embedding.length;
        if (this._storedDim === null) {
            this._storedDim = dim;
            return;
        }
        if (dim !== this._storedDim) {
            throw new Error(`Embedding dimension mismatch: existing data uses ${this._storedDim}-dim, ` +
                `current backend (${EMBEDDING_BACKEND}) produces ${dim}-dim.\n` +
                `To switch backends, delete ~/.super-memory/graph.json first.`);
        }
    }
    _isExpired(mem) {
        return mem.ttl != null && Date.now() / 1000 > mem.ttl;
    }
    _timeFactor(mem) {
        const age = Date.now() / 1000 - mem.created_at;
        const decayRate = 1.0 - mem.depth * 0.7;
        const decay = Math.exp((-age * decayRate) / MemoryGraph.TIME_HALF_LIFE);
        return 0.5 + 0.5 * decay;
    }
    _keyIdf(keyId) {
        const freq = this._keyToMems[keyId]?.size ?? 0;
        if (freq <= 1)
            return 1.0;
        let idf = 1.0 / freq;
        const kt = this.keys[keyId]?.key_type;
        if (kt === "name" || kt === "proper_noun")
            idf *= 0.5;
        return idf;
    }
    _findDuplicate(embedding) {
        const activeMems = Object.entries(this.memories).filter(([mid]) => !(mid in this._supersededBy));
        if (activeMems.length === 0)
            return null;
        const matrix = activeMems.map(([, mem]) => mem.embedding);
        const sims = batchCosineSim(embedding, matrix);
        let bestIdx = 0, bestSim = -Infinity;
        for (let i = 0; i < sims.length; i++) {
            if (sims[i] > bestSim) {
                bestSim = sims[i];
                bestIdx = i;
            }
        }
        return bestSim >= MEMORY_DEDUP_THRESHOLD ? activeMems[bestIdx][0] : null;
    }
    _autoLinkKeys(memId, embedding) {
        const keyIds = Object.keys(this.keys);
        if (keyIds.length === 0)
            return;
        const matrix = keyIds.map((kid) => this.keys[kid].embedding);
        const sims = batchCosineSim(embedding, matrix);
        for (let i = 0; i < keyIds.length; i++) {
            if (sims[i] >= KEY_AUTO_LINK_THRESHOLD && !this._hasLink(keyIds[i], memId)) {
                this._link(keyIds[i], memId);
            }
        }
    }
    getKeysForMemory(memId) {
        const kids = this._memToKeys[memId];
        if (!kids)
            return [];
        return [...kids]
            .filter((kid) => kid in this.keys)
            .map((kid) => this.keys[kid].concept);
    }
    // ── I/O ──
    async load() {
        let raw;
        try {
            const text = await readFile(GRAPH_FILE, "utf-8");
            raw = JSON.parse(text);
        }
        catch {
            return;
        }
        for (const [kid, k] of Object.entries(raw.keys ?? {})) {
            this.keys[kid] = k;
        }
        for (const [mid, m] of Object.entries(raw.memories ?? {})) {
            const defaults = {
                depth: 0.0,
                access_count: 0,
                last_accessed: 0,
                namespace: "default",
                ttl: null,
                links: [],
                source: null,
                supersedes: null,
            };
            const mem = { ...defaults, ...m };
            if (!mem.embedding || mem.embedding.length === 0) {
                mem.embedding = await embedTextAsync(mem.content);
            }
            this.memories[mid] = mem;
        }
        if (Object.keys(this.memories).length > 0) {
            const firstMem = Object.values(this.memories)[0];
            this._storedDim = firstMem.embedding.length;
        }
        for (const lnk of raw.links ?? []) {
            this._link(lnk.key_id, lnk.memory_id);
        }
        for (const [mid, mem] of Object.entries(this.memories)) {
            if (mem.supersedes) {
                this._supersededBy[mem.supersedes] = mid;
            }
        }
        console.error(`[graph] loaded ${Object.keys(this.keys).length} keys, ` +
            `${Object.keys(this.memories).length} memories, ${this.linkCount} links`);
    }
    async save() {
        await mkdir(DATA_DIR, { recursive: true });
        const links = [];
        for (const [kid, mids] of Object.entries(this._keyToMems)) {
            for (const mid of mids) {
                links.push({ key_id: kid, memory_id: mid });
            }
        }
        const data = {
            keys: this.keys,
            memories: this.memories,
            links,
        };
        await writeFile(GRAPH_FILE, JSON.stringify(data, null, 2), "utf-8");
        this._dirty = false;
    }
    markDirty() {
        this._dirty = true;
    }
    async flush() {
        if (this._dirty)
            await this.save();
    }
    // ── Key management ──
    async findOrCreateKey(concept, keyType = "concept") {
        if (keyType === "name" || keyType === "proper_noun") {
            for (const [kid, key] of Object.entries(this.keys)) {
                if (key.concept === concept && key.key_type === keyType)
                    return kid;
            }
            const kid = uid();
            this.keys[kid] = {
                id: kid,
                concept,
                embedding: await embedTextAsync(concept),
                key_type: keyType,
            };
            return kid;
        }
        const emb = await embedTextAsync(concept);
        const conceptKeys = Object.entries(this.keys).filter(([, k]) => k.key_type === "concept");
        if (conceptKeys.length > 0) {
            const matrix = conceptKeys.map(([, k]) => k.embedding);
            const sims = batchCosineSim(emb, matrix);
            let bestIdx = 0, bestSim = -Infinity;
            for (let i = 0; i < sims.length; i++) {
                if (sims[i] > bestSim) {
                    bestSim = sims[i];
                    bestIdx = i;
                }
            }
            if (bestSim >= KEY_MERGE_THRESHOLD)
                return conceptKeys[bestIdx][0];
        }
        const kid = uid();
        this.keys[kid] = { id: kid, concept, embedding: emb, key_type: "concept" };
        return kid;
    }
    // ── Add ──
    async add(content, keyConcepts, options = {}) {
        const embedding = await embedTextAsync(content); // outside lock
        let dupId = null;
        await this._lock.runExclusive(async () => {
            this._checkDim(embedding);
            dupId = this._findDuplicate(embedding);
        });
        if (dupId !== null) {
            const newId = await this.supersede(dupId, content, {
                keyConcepts,
                keyTypes: options.keyTypes ?? undefined,
                source: options.source,
                namespace: options.namespace,
                relatedTo: options.relatedTo,
            });
            return [newId, true];
        }
        let resultMid = "";
        await this._lock.runExclusive(async () => {
            const mid = uid();
            resultMid = mid;
            const now = Date.now() / 1000;
            const expiresAt = options.ttlSeconds != null ? now + options.ttlSeconds : null;
            const validLinks = (options.relatedTo ?? []).filter((lid) => lid in this.memories);
            this.memories[mid] = {
                id: mid,
                content,
                embedding,
                created_at: now,
                source: options.source ?? null,
                supersedes: null,
                depth: 0.0,
                access_count: 0,
                last_accessed: now,
                namespace: options.namespace ?? "default",
                ttl: expiresAt,
                links: validLinks,
            };
            const sanitized = sanitizeKeys(keyConcepts);
            const keyTypes = options.keyTypes ?? {};
            for (const concept of sanitized) {
                const kt = (keyTypes[concept] ?? "concept");
                const kid = await this.findOrCreateKey(concept, kt);
                if (!this._hasLink(kid, mid))
                    this._link(kid, mid);
            }
            this._autoLinkKeys(mid, embedding);
            await this.save();
        });
        return [resultMid, false];
    }
    // ── Supersede ──
    async supersede(oldId, newContent, options = {}) {
        const newEmbedding = await embedTextAsync(newContent); // outside lock
        let resultMid = "";
        await this._lock.runExclusive(async () => {
            if (!(oldId in this.memories)) {
                throw new Error(`Memory ${oldId} not found`);
            }
            const old = this.memories[oldId];
            // Chain cleanup: keep depth max 1 (new → old; grandparent deleted)
            const grandparentId = old.supersedes;
            if (grandparentId && grandparentId in this.memories) {
                delete this.memories[grandparentId];
                this._unlinkMemory(grandparentId);
                delete this._supersededBy[grandparentId];
                this._pruneOrphanKeys();
            }
            const mid = uid();
            resultMid = mid;
            const now = Date.now() / 1000;
            const ns = options.namespace ?? old.namespace;
            const validLinks = (options.relatedTo ?? []).filter((lid) => lid in this.memories);
            this.memories[mid] = {
                id: mid,
                content: newContent,
                embedding: newEmbedding,
                created_at: now,
                source: options.source ?? null,
                supersedes: oldId,
                depth: 0.0,
                access_count: 0,
                last_accessed: now,
                namespace: ns,
                ttl: old.ttl,
                links: validLinks,
            };
            // Weaken old memory depth
            old.depth =
                old.depth >= DEPTH_DEEP_THRESHOLD
                    ? old.depth * 0.8
                    : old.depth * 0.3;
            this._supersededBy[oldId] = mid;
            const keyConcepts = options.keyConcepts;
            if (keyConcepts && keyConcepts.length > 0) {
                const sanitized = sanitizeKeys(keyConcepts);
                const keyTypes = options.keyTypes ?? {};
                for (const concept of sanitized) {
                    const kt = (keyTypes[concept] ?? "concept");
                    const kid = await this.findOrCreateKey(concept, kt);
                    this._link(kid, mid);
                }
            }
            else {
                // Copy old links (snapshot to avoid mutation during iteration)
                for (const kid of [...(this._memToKeys[oldId] ?? new Set())]) {
                    this._link(kid, mid);
                }
            }
            this._autoLinkKeys(mid, newEmbedding);
            await this.save();
        });
        return resultMid;
    }
    // ── Recall ──
    async recall(query, topK = 5, namespace, expand = false) {
        if (Object.keys(this.memories).length === 0)
            return [];
        const qEmb = await embedTextAsync(query); // outside lock
        this._checkDim(qEmb);
        const results = [];
        await this._lock.runExclusive(async () => {
            const queryLower = query.toLowerCase().trim();
            const memScores = {};
            const memMatchedKeys = {};
            const memHop = {};
            const skip = (mid) => {
                if (!(mid in this.memories))
                    return true;
                const mem = this.memories[mid];
                if (this._isExpired(mem))
                    return true;
                if (namespace && mem.namespace !== namespace)
                    return true;
                if (mid in this._supersededBy)
                    return true;
                return false;
            };
            // ── Path A: Key batch matching → links → memories ──
            const keyIds = Object.keys(this.keys);
            const keySims = keyIds.length > 0
                ? batchCosineSim(qEmb, keyIds.map((kid) => this.keys[kid].embedding))
                : [];
            const keyScores = [];
            for (let i = 0; i < keyIds.length; i++) {
                const kid = keyIds[i];
                const key = this.keys[kid];
                if (key.key_type === "name" || key.key_type === "proper_noun") {
                    if (queryLower.includes(key.concept.toLowerCase())) {
                        keyScores.push([1.0, kid]);
                    }
                }
                else if (keySims[i] >= KEY_RECALL_THRESHOLD) {
                    keyScores.push([keySims[i], kid]);
                }
            }
            keyScores.sort((a, b) => b[0] - a[0]);
            for (const [keySim, kid] of keyScores.slice(0, 10)) {
                const idf = this._keyIdf(kid);
                for (const memId of this._keyToMems[kid] ?? new Set()) {
                    if (skip(memId))
                        continue;
                    const mem = this.memories[memId];
                    const depthFactor = 0.9 + mem.depth * 0.1;
                    const tf = this._timeFactor(mem);
                    const score = keySim * idf * depthFactor * tf;
                    memScores[memId] = (memScores[memId] ?? 0) + score;
                    if (!memMatchedKeys[memId])
                        memMatchedKeys[memId] = [];
                    memMatchedKeys[memId].push(this.keys[kid].concept);
                    memHop[memId] = 1;
                }
            }
            // ── Path B: Content batch direct matching ──
            const memIds = Object.keys(this.memories);
            if (memIds.length > 0) {
                const contentSims = batchCosineSim(qEmb, memIds.map((mid) => this.memories[mid].embedding));
                for (let i = 0; i < memIds.length; i++) {
                    const mid = memIds[i];
                    if (skip(mid))
                        continue;
                    const cSim = contentSims[i];
                    if (cSim >= CONTENT_RECALL_THRESHOLD) {
                        const mem = this.memories[mid];
                        const depthFactor = 0.9 + mem.depth * 0.1;
                        const tf = this._timeFactor(mem);
                        const contentScore = cSim * depthFactor * tf * 0.8;
                        if (mid in memScores) {
                            memScores[mid] += contentScore * 0.2;
                        }
                        else {
                            memScores[mid] = contentScore;
                        }
                        if (!memMatchedKeys[mid])
                            memMatchedKeys[mid] = [];
                        memMatchedKeys[mid].push("(content)");
                        if (!(mid in memHop))
                            memHop[mid] = 1;
                    }
                }
            }
            // ── 2-hop: via shared keys ──
            for (const mid of Object.keys(memScores)) {
                const hop1Score = memScores[mid];
                for (const kid of this._memToKeys[mid] ?? new Set()) {
                    if (!(kid in this.keys))
                        continue;
                    const concept = this.keys[kid].concept;
                    const idf = this._keyIdf(kid);
                    for (const otherMid of this._keyToMems[kid] ?? new Set()) {
                        if (otherMid === mid || skip(otherMid))
                            continue;
                        const hop2Score = hop1Score * MemoryGraph.HOP_DECAY * idf;
                        memScores[otherMid] = (memScores[otherMid] ?? 0) + hop2Score;
                        if (!memMatchedKeys[otherMid])
                            memMatchedKeys[otherMid] = [];
                        memMatchedKeys[otherMid].push(`${concept}(via)`);
                        if (!(otherMid in memHop))
                            memHop[otherMid] = 2;
                    }
                }
            }
            // ── Explicit link traversal ──
            for (const mid of Object.keys(memScores)) {
                const hop1Score = memScores[mid];
                const memObj = this.memories[mid];
                if (!memObj)
                    continue;
                for (const linkedId of memObj.links) {
                    if (linkedId === mid || skip(linkedId))
                        continue;
                    const linkScore = hop1Score * MemoryGraph.HOP_DECAY;
                    memScores[linkedId] = (memScores[linkedId] ?? 0) + linkScore;
                    if (!memMatchedKeys[linkedId])
                        memMatchedKeys[linkedId] = [];
                    memMatchedKeys[linkedId].push("(linked)");
                    if (!(linkedId in memHop))
                        memHop[linkedId] = 2;
                }
            }
            if (expand) {
                for (const mid of Object.keys(memScores)) {
                    if ((memHop[mid] ?? 1) === 2)
                        memScores[mid] *= 0.7;
                }
            }
            const actualTopK = expand ? topK * 2 : topK;
            const ranked = Object.entries(memScores)
                .sort(([, a], [, b]) => b - a)
                .slice(0, actualTopK);
            for (const [mid, score] of ranked) {
                const mem = this.memories[mid];
                mem.depth = Math.min(mem.depth + DEPTH_INCREMENT, DEPTH_MAX);
                mem.access_count += 1;
                mem.last_accessed = Date.now() / 1000;
                results.push({
                    id: mid,
                    content: mem.content,
                    keys: this.getKeysForMemory(mid),
                    matched_via: [...new Set(memMatchedKeys[mid] ?? [])],
                    hop: memHop[mid] ?? 1,
                    score: Math.round(score * 1000) / 1000,
                    depth: Math.round(mem.depth * 1000) / 1000,
                    access_count: mem.access_count,
                    source: mem.source,
                    supersedes: mem.supersedes,
                    superseded_by: this._supersededBy[mid] ?? null,
                    created_at: mem.created_at,
                    namespace: mem.namespace,
                    links: mem.links,
                });
            }
            this.markDirty();
        });
        await this.flush(); // outside lock
        return results;
    }
    // ── Related ──
    getRelated(memoryId) {
        if (!(memoryId in this.memories))
            return [];
        const related = {};
        // Key-sharing
        for (const kid of this._memToKeys[memoryId] ?? new Set()) {
            const concept = this.keys[kid]?.concept ?? "?";
            for (const mid of this._keyToMems[kid] ?? new Set()) {
                if (mid === memoryId || !(mid in this.memories))
                    continue;
                const mem = this.memories[mid];
                if (this._isExpired(mem) || mid in this._supersededBy)
                    continue;
                if (!related[mid]) {
                    related[mid] = {
                        id: mid,
                        content: mem.content,
                        shared_keys: [],
                        link_type: "key",
                        depth: Math.round(mem.depth * 1000) / 1000,
                    };
                }
                if (!related[mid].shared_keys.includes(concept)) {
                    related[mid].shared_keys.push(concept);
                }
            }
        }
        // Explicit links (→)
        const sourceMem = this.memories[memoryId];
        for (const linkedId of sourceMem.links) {
            if (!(linkedId in this.memories) || linkedId === memoryId)
                continue;
            const mem = this.memories[linkedId];
            if (this._isExpired(mem))
                continue;
            if (!related[linkedId]) {
                related[linkedId] = {
                    id: linkedId,
                    content: mem.content,
                    shared_keys: ["(explicit →)"],
                    link_type: "explicit",
                    depth: Math.round(mem.depth * 1000) / 1000,
                };
            }
            else {
                related[linkedId].link_type = "both";
                if (!related[linkedId].shared_keys.includes("(explicit →)")) {
                    related[linkedId].shared_keys.push("(explicit →)");
                }
            }
        }
        // Reverse links (←)
        for (const [mid, mem] of Object.entries(this.memories)) {
            if (mid === memoryId || this._isExpired(mem))
                continue;
            if (mem.links.includes(memoryId)) {
                if (!related[mid]) {
                    related[mid] = {
                        id: mid,
                        content: mem.content,
                        shared_keys: ["(explicit ←)"],
                        link_type: "explicit",
                        depth: Math.round(mem.depth * 1000) / 1000,
                    };
                }
                else if (!related[mid].shared_keys.includes("(explicit ←)")) {
                    related[mid].shared_keys.push("(explicit ←)");
                }
            }
        }
        return Object.values(related);
    }
    // ── Delete ──
    async delete(memoryId) {
        return this._lock.runExclusive(async () => {
            if (!(memoryId in this.memories))
                return false;
            delete this.memories[memoryId];
            this._unlinkMemory(memoryId);
            this._pruneOrphanKeys();
            delete this._supersededBy[memoryId];
            for (const [oldId, newId] of Object.entries(this._supersededBy)) {
                if (newId === memoryId)
                    delete this._supersededBy[oldId];
            }
            await this.save();
            return true;
        });
    }
    // ── List all ──
    listAll(namespace) {
        return Object.entries(this.memories)
            .filter(([mid, mem]) => {
            if (this._isExpired(mem))
                return false;
            if (mid in this._supersededBy)
                return false;
            if (namespace && mem.namespace !== namespace)
                return false;
            return true;
        })
            .map(([mid, mem]) => ({
            id: mid,
            content: mem.content,
            keys: this.getKeysForMemory(mid),
            depth: Math.round(mem.depth * 1000) / 1000,
            access_count: mem.access_count,
            supersedes: mem.supersedes,
            created_at: mem.created_at,
            namespace: mem.namespace,
            expires_at: mem.ttl,
            links: mem.links,
        }));
    }
    // ── Cleanup expired ──
    async cleanupExpired() {
        return this._lock.runExclusive(async () => {
            const expired = Object.entries(this.memories)
                .filter(([, mem]) => this._isExpired(mem))
                .map(([mid]) => mid);
            for (const mid of expired) {
                delete this.memories[mid];
                this._unlinkMemory(mid);
                delete this._supersededBy[mid];
                for (const [oldId, newId] of Object.entries(this._supersededBy)) {
                    if (newId === mid)
                        delete this._supersededBy[oldId];
                }
            }
            this._pruneOrphanKeys();
            if (expired.length > 0)
                await this.save();
            return expired.length;
        });
    }
    // ── Dream ──
    //
    // The agent's SLEEP-state operation. A memory is rewritten in compressed form,
    // its detail fading. Keys, links, and the memory's identity are preserved.
    //
    // This is the technical implementation of intentional forgetting — the kind
    // human memory does during REM sleep. Recall by key still finds the memory,
    // and the memory still exists as a node in the graph, but its content is
    // a compression of what it was.
    //
    // Each call to dream() advances the memory's depth by 0.2. As depth grows,
    // the agent's recall returns less detail and more "I remember it was here."
    //
    // Caller is responsible for generating the compressed content (via LLM).
    // This method only mutates the graph.
    async dream(args) {
        return this._lock.runExclusive(async () => {
            const mem = this.memories[args.memoryId];
            if (!mem) {
                throw new Error(`dream: memory ${args.memoryId} not found`);
            }
            const prev = mem.content;
            const newEmbedding = await embedTextAsync(args.compressedContent);
            mem.content = args.compressedContent;
            mem.embedding = newEmbedding;
            mem.depth = Math.min(DEPTH_MAX, mem.depth + (args.depthIncrement ?? 0.2));
            // keys, links, supersedes chain — all preserved.
            await this.save();
            return {
                id: mem.id,
                depth: Math.round(mem.depth * 1000) / 1000,
                previousContent: prev,
            };
        });
    }
    // List recent memories — used by SLEEP-state to decide what to dream over.
    listRecent(limit = 20) {
        return Object.entries(this.memories)
            .filter(([mid, mem]) => !this._isExpired(mem) && !(mid in this._supersededBy))
            .sort(([, a], [, b]) => b.created_at - a.created_at)
            .slice(0, limit)
            .map(([mid, mem]) => ({
            id: mid,
            content: mem.content,
            depth: Math.round(mem.depth * 1000) / 1000,
            created_at: mem.created_at,
            access_count: mem.access_count,
        }));
    }
    // List shallow memories — those that have not yet been dreamed enough.
    listShallow(maxDepth = 0.3, limit = 20) {
        return Object.entries(this.memories)
            .filter(([mid, mem]) => {
            if (this._isExpired(mem) || mid in this._supersededBy)
                return false;
            return mem.depth < maxDepth;
        })
            .sort(([, a], [, b]) => a.created_at - b.created_at) // oldest shallow first
            .slice(0, limit)
            .map(([mid, mem]) => ({
            id: mid,
            content: mem.content,
            depth: Math.round(mem.depth * 1000) / 1000,
            created_at: mem.created_at,
        }));
    }
    // ── Sleep operations ──────────────────────────────────────
    //
    // These are intentionally separate from the existing recall/remember API
    // because they are SYSTEM operations during SLEEP, not agent tools.
    // The agent does not call them directly — the sleep cycle does.
    // Prune memories that have never been recalled and are old enough that
    // they have likely been forgotten anyway. Returns the ids of pruned memories.
    // "weak" criteria: access_count = 0 AND depth < 0.05 AND age > minAgeSec.
    async pruneWeak(options = {}) {
        const minAgeSec = options.minAgeSec ?? 7 * 24 * 3600; // a week
        const maxToPrune = options.maxToPrune ?? 50;
        return this._lock.runExclusive(async () => {
            const now = Date.now() / 1000;
            const candidates = Object.entries(this.memories).filter(([mid, mem]) => {
                if (mid in this._supersededBy)
                    return false;
                if (mem.access_count > 0)
                    return false;
                if (mem.depth >= 0.05)
                    return false;
                if (now - mem.created_at < minAgeSec)
                    return false;
                return true;
            });
            const toPrune = candidates
                .sort(([, a], [, b]) => a.created_at - b.created_at)
                .slice(0, maxToPrune)
                .map(([mid]) => mid);
            for (const mid of toPrune) {
                delete this.memories[mid];
                this._unlinkMemory(mid);
                delete this._supersededBy[mid];
                for (const [oldId, newId] of Object.entries(this._supersededBy)) {
                    if (newId === mid)
                        delete this._supersededBy[oldId];
                }
            }
            this._pruneOrphanKeys();
            if (toPrune.length > 0)
                await this.save();
            return toPrune;
        });
    }
    // Find clusters of memories that share many keys. A cluster is a group
    // of memories that all link to the same set of N or more keys.
    // Returns clusters above a minimum size — the sleep cycle uses these to
    // ask the LLM to write a schema (a higher-order memory) that abstracts them.
    findClusters(options = {}) {
        const minSharedKeys = options.minSharedKeys ?? 2;
        const minClusterSize = options.minClusterSize ?? 3;
        const maxClusters = options.maxClusters ?? 5;
        // For each pair of keys, count memories that link to both.
        const keyIds = Object.keys(this.keys);
        const clusters = [];
        // Try pairs of keys (could extend to triples but quadratic is fine for ~100s of memories).
        for (let i = 0; i < keyIds.length; i++) {
            for (let j = i + 1; j < keyIds.length; j++) {
                const a = keyIds[i];
                const b = keyIds[j];
                const memsA = this._keyToMems[a];
                const memsB = this._keyToMems[b];
                if (!memsA || !memsB)
                    continue;
                const shared = [];
                for (const mid of memsA) {
                    if (memsB.has(mid) && !(mid in this._supersededBy)) {
                        shared.push(mid);
                    }
                }
                if (shared.length >= minClusterSize) {
                    clusters.push({
                        keys: [this.keys[a].concept, this.keys[b].concept],
                        memoryIds: shared,
                        contents: shared
                            .map((mid) => this.memories[mid]?.content)
                            .filter((c) => !!c),
                    });
                }
            }
        }
        // Deduplicate by overlapping memory sets — keep the larger one when overlap is high.
        clusters.sort((x, y) => y.memoryIds.length - x.memoryIds.length);
        const kept = [];
        for (const c of clusters) {
            const overlapsExisting = kept.some((k) => {
                const overlap = c.memoryIds.filter((m) => k.memoryIds.includes(m)).length;
                return overlap / Math.min(k.memoryIds.length, c.memoryIds.length) > 0.7;
            });
            if (!overlapsExisting)
                kept.push(c);
            if (kept.length >= maxClusters)
                break;
        }
        return kept;
    }
    // Pick a random pair of memories that share no keys — for REM-like
    // creative association. The sleep cycle asks the LLM whether there is an
    // unexpected connection; if so, a new key links them.
    pickRandomDistantPair() {
        const ids = Object.keys(this.memories).filter((mid) => !(mid in this._supersededBy));
        if (ids.length < 2)
            return null;
        // Try a few random pairs and pick the most-distant one (no shared keys).
        for (let attempt = 0; attempt < 6; attempt++) {
            const i = Math.floor(Math.random() * ids.length);
            let j = Math.floor(Math.random() * ids.length);
            while (j === i)
                j = Math.floor(Math.random() * ids.length);
            const a = ids[i];
            const b = ids[j];
            const ka = this._memToKeys[a] ?? new Set();
            const kb = this._memToKeys[b] ?? new Set();
            let shared = 0;
            for (const k of ka) {
                if (kb.has(k)) {
                    shared++;
                    break;
                }
            }
            if (shared === 0) {
                return {
                    a: { id: a, content: this.memories[a].content },
                    b: { id: b, content: this.memories[b].content },
                };
            }
        }
        return null;
    }
    // Add an explicit link between two memories — used after creative association.
    async link(memA, memB, viaKey) {
        return this._lock.runExclusive(async () => {
            const a = this.memories[memA];
            const b = this.memories[memB];
            if (!a || !b)
                return;
            if (!a.links.includes(memB))
                a.links.push(memB);
            if (!b.links.includes(memA))
                b.links.push(memA);
            const kid = await this.findOrCreateKey(viaKey, "concept");
            if (!this._hasLink(kid, memA))
                this._link(kid, memA);
            if (!this._hasLink(kid, memB))
                this._link(kid, memB);
            await this.save();
        });
    }
    // Stats — used in status command and SLEEP cycle preamble.
    stats() {
        const all = Object.values(this.memories);
        const active = all.filter((m) => !this._isExpired(m));
        const totalDepth = active.reduce((s, m) => s + m.depth, 0);
        const totalLen = active.reduce((s, m) => s + m.content.length, 0);
        return {
            keyCount: Object.keys(this.keys).length,
            memoryCount: all.length,
            activeMemoryCount: active.length,
            linkCount: this.linkCount,
            avgDepth: active.length ? totalDepth / active.length : 0,
            avgContentLen: active.length ? totalLen / active.length : 0,
        };
    }
}
// ── Conversation store ──
export async function saveTurn(sessionId, role, content) {
    await mkdir(CONVERSATIONS_DIR, { recursive: true });
    const path = join(CONVERSATIONS_DIR, `${sessionId}.jsonl`);
    let turn = 0;
    try {
        const text = await readFile(path, "utf-8");
        turn = text.split("\n").filter((l) => l.trim()).length;
    }
    catch {
        // file does not exist yet
    }
    const entry = JSON.stringify({
        turn,
        role,
        content,
        ts: Date.now() / 1000,
    });
    await appendFile(path, entry + "\n", "utf-8");
    return turn;
}
export async function loadConversation(sessionId, turn) {
    const path = join(CONVERSATIONS_DIR, `${sessionId}.jsonl`);
    let text;
    try {
        text = await readFile(path, "utf-8");
    }
    catch {
        return [];
    }
    const lines = text
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    if (turn != null) {
        const start = Math.max(0, turn - 2);
        const end = Math.min(lines.length, turn + 3);
        return lines.slice(start, end);
    }
    return lines;
}
//# sourceMappingURL=graph.js.map