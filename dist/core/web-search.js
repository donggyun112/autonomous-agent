// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// Web search implementation. Ported from openclaw/src/agents/tools/web-search.ts.
// We keep only the Brave provider (Perplexity/Grok dropped) since Brave is
// the simplest backend and returns structured results the agent can cite.
// ===========================================================================
//
// Requires BRAVE_API_KEY in the environment. If missing, the tool returns
// a descriptive error rather than throwing.
//
// External-content wrapping (external-content.ts, wrapWebContent) is applied
// to all returned text so the agent's system reminder about untrusted content
// stays visible around retrieved snippets.
import { wrapWebContent } from "./external-content.js";
import { DEFAULT_CACHE_TTL_MINUTES, DEFAULT_TIMEOUT_SECONDS, normalizeCacheKey, readCache, readResponseText, resolveCacheTtlMs, resolveTimeoutSeconds, withTimeout, writeCache, } from "./web-shared.js";
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const BRAVE_FRESHNESS_SHORTCUTS = new Set(["pd", "pw", "pm", "py"]);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;
const SEARCH_CACHE = new Map();
function resolveSiteName(url) {
    if (!url)
        return undefined;
    try {
        return new URL(url).hostname;
    }
    catch {
        return undefined;
    }
}
function isValidIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day))
        return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day);
}
function normalizeFreshness(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    const lower = trimmed.toLowerCase();
    if (BRAVE_FRESHNESS_SHORTCUTS.has(lower))
        return lower;
    const match = trimmed.match(BRAVE_FRESHNESS_RANGE);
    if (!match)
        return undefined;
    const [, start, end] = match;
    if (!isValidIsoDate(start) || !isValidIsoDate(end))
        return undefined;
    if (start > end)
        return undefined;
    return `${start}to${end}`;
}
function resolveSearchCount(value, fallback) {
    const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
}
function getApiKey() {
    const key = process.env.BRAVE_API_KEY?.trim();
    return key || undefined;
}
export async function webSearch(args) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return {
            ok: false,
            error: "missing_brave_api_key",
            message: "web_search needs a Brave Search API key. Set BRAVE_API_KEY in the environment. Get a free key at https://brave.com/search/api/",
        };
    }
    const query = args.query?.trim();
    if (!query) {
        return { ok: false, error: "missing_query", message: "web_search requires a non-empty query." };
    }
    const count = resolveSearchCount(args.count, DEFAULT_SEARCH_COUNT);
    const freshness = normalizeFreshness(args.freshness);
    const timeoutMs = resolveTimeoutSeconds(undefined, DEFAULT_TIMEOUT_SECONDS) * 1000;
    const cacheTtlMs = resolveCacheTtlMs(undefined, DEFAULT_CACHE_TTL_MINUTES);
    const cacheKey = normalizeCacheKey(`brave:${query}:${count}:${args.country || "default"}:${args.search_lang || "default"}:${args.ui_lang || "default"}:${freshness || "default"}`);
    const cached = readCache(SEARCH_CACHE, cacheKey);
    if (cached) {
        return { ...cached.value, cached: true, ok: true };
    }
    const url = new URL(BRAVE_SEARCH_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    if (args.country)
        url.searchParams.set("country", args.country);
    if (args.search_lang)
        url.searchParams.set("search_lang", args.search_lang);
    if (args.ui_lang)
        url.searchParams.set("ui_lang", args.ui_lang);
    if (freshness)
        url.searchParams.set("freshness", freshness);
    const start = Date.now();
    let res;
    try {
        res = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Accept: "application/json",
                "X-Subscription-Token": apiKey,
            },
            signal: withTimeout(undefined, timeoutMs),
        });
    }
    catch (err) {
        return {
            ok: false,
            error: "network_error",
            message: `Brave Search network error: ${err.message}`,
        };
    }
    if (!res.ok) {
        const detailResult = await readResponseText(res, { maxBytes: 64_000 });
        const detail = detailResult.text;
        return {
            ok: false,
            error: "brave_api_error",
            message: `Brave Search API error (${res.status}): ${detail || res.statusText}`,
        };
    }
    const data = (await res.json());
    const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
    const mapped = results.map((entry) => {
        const description = entry.description ?? "";
        const title = entry.title ?? "";
        const u = entry.url ?? "";
        const rawSiteName = resolveSiteName(u);
        return {
            title: title ? wrapWebContent(title, "web_search") : "",
            url: u,
            description: description ? wrapWebContent(description, "web_search") : "",
            published: entry.age || undefined,
            siteName: rawSiteName || undefined,
        };
    });
    const payload = {
        ok: true,
        query,
        provider: "brave",
        count: mapped.length,
        tookMs: Date.now() - start,
        results: mapped,
    };
    writeCache(SEARCH_CACHE, cacheKey, payload, cacheTtlMs);
    return payload;
}
//# sourceMappingURL=web-search.js.map