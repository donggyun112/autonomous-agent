// AuthSource backed by OAuth credentials stored on disk.
//
// Reads the credentials file, returns the access token if it is still valid,
// or refreshes it via refreshAnthropicToken if expired. Refresh is guarded by
// a per-provider lock so that concurrent callers don't race on single-use
// refresh tokens (OAuth refresh tokens are invalidated by the authorization
// server as soon as they are used once).
//
// Pattern borrowed from IN7PM's src/agent/auth.ts.
import { join, dirname } from "path";
import { refreshAnthropicToken } from "./anthropic.js";
import { loadCredentials, saveAnthropicCredentials, credentialsFilePath } from "./storage.js";
// P2 fix: cross-process file lock for OAuth refresh. The in-memory
// `refreshInFlight` promise only serializes within a single Node process.
// If two processes (daemon + CLI) detect expiry at the same time, both
// read the same one-time-use refresh token and one request invalidates
// the other. A file lock ensures only one process refreshes at a time.
//
// We use advisory flock-style locking via fs.open with O_CREAT + O_RDWR
// and then process.kill(0) for a lightweight lock. On failure to acquire
// we re-read credentials (the winner may have already refreshed).
const LOCK_DIR = join(dirname(credentialsFilePath()), ".refresh.lock.d");
// Cross-process exclusive lock using mkdir atomicity. mkdir fails with
// EEXIST if the directory already exists, giving us a reliable mutex
// that works across processes on all filesystems (unlike flock/open("w")).
// Stale locks (from crashed processes) are broken after STALE_LOCK_MS.
// Stale lock threshold must be LESS than total retry budget so we can
// actually break a stale lock and retry within the same invocation.
// Round-4 fix: STALE=35s, budget=80*500ms=40s → stale lock is broken
// at ~35s, leaving ~5s for the retry. Network timeout is 30s.
const STALE_LOCK_MS = 35_000;
async function withFileLock(fn) {
    const { mkdir: mkd, rm, stat: fstat, writeFile: wf } = await import("fs/promises");
    await mkd(dirname(LOCK_DIR), { recursive: true });
    const maxAttempts = 80;
    const retryMs = 500; // 80 * 500ms = 40s > STALE_LOCK_MS (35s)
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            // mkdir is atomic — if it succeeds, we own the lock.
            await mkd(LOCK_DIR);
            // Write PID for stale detection.
            await wf(join(LOCK_DIR, "pid"), String(process.pid), "utf-8");
            break;
        }
        catch (err) {
            if (err.code !== "EEXIST")
                throw err;
            // Lock exists — check if it's stale.
            try {
                const st = await fstat(LOCK_DIR);
                if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
                    // Stale lock from a crashed process. Break it.
                    await rm(LOCK_DIR, { recursive: true, force: true });
                    continue;
                }
            }
            catch {
                // Lock dir vanished between EEXIST and stat — retry.
                continue;
            }
            if (attempt >= maxAttempts - 1) {
                // Give up — re-read credentials in case the winner already refreshed.
                const fresh = (await loadCredentials()).anthropic;
                if (fresh && Date.now() < fresh.expires - 5 * 60 * 1000) {
                    return fresh; // Winner already refreshed.
                }
                throw new Error("OAuth refresh lock timeout — another process may be stuck.");
            }
            await new Promise((r) => setTimeout(r, retryMs));
        }
    }
    try {
        return await fn();
    }
    finally {
        await rm(LOCK_DIR, { recursive: true, force: true }).catch(() => { });
    }
}
export class AnthropicOAuthSource {
    id = "anthropic-oauth";
    // In-memory cache of the most recently loaded/refreshed credentials.
    // Primed lazily on first getApiKey() call.
    cached = null;
    // Promise guard for concurrent refresh. Multiple cycles running in parallel
    // (sleep consolidation + auto-compact + main loop) could all detect expiry
    // at the same moment and each try to refresh — single-use refresh tokens
    // would then invalidate each other. We serialize them behind one promise.
    refreshInFlight = null;
    describe() {
        return "Anthropic OAuth (Claude Pro/Max login)";
    }
    async load() {
        if (this.cached)
            return this.cached;
        const all = await loadCredentials();
        this.cached = all.anthropic ?? null;
        return this.cached;
    }
    isExpired(creds) {
        // Refresh 5 minutes early to avoid racing the server's own clock.
        return Date.now() >= creds.expires - 5 * 60 * 1000;
    }
    async refresh() {
        if (this.refreshInFlight)
            return this.refreshInFlight;
        const doRefresh = async () => {
            // P2 fix: use file lock so two processes don't race on the same
            // one-time-use refresh token. The winner refreshes and saves; the
            // loser re-reads and finds the fresh token on disk.
            return withFileLock(async () => {
                // Re-read from disk — another process may have already refreshed.
                const fresh = (await loadCredentials()).anthropic;
                if (!fresh) {
                    throw new Error("No Anthropic OAuth credentials on disk. Run 'pnpm login' to authenticate.");
                }
                if (!this.isExpired(fresh)) {
                    this.cached = fresh;
                    return fresh;
                }
                const rotated = await refreshAnthropicToken(fresh.refresh);
                await saveAnthropicCredentials(rotated);
                this.cached = rotated;
                return rotated;
            });
        };
        this.refreshInFlight = doRefresh().finally(() => {
            this.refreshInFlight = null;
        });
        return this.refreshInFlight;
    }
    async getApiKey() {
        let creds = await this.load();
        if (!creds) {
            throw new Error("No Anthropic OAuth credentials. Run 'pnpm login' to authenticate.");
        }
        if (this.isExpired(creds)) {
            creds = await this.refresh();
        }
        return creds.access;
    }
}
//# sourceMappingURL=oauth.js.map