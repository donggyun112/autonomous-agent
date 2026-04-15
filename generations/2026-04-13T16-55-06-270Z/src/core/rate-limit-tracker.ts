// Rate limit window tracking — preemptive avoidance.
const hits = new Map<string, number[]>();

export function recordRateLimit(key: string): void {
  if (!hits.has(key)) hits.set(key, []);
  hits.get(key)!.push(Date.now());
  const cutoff = Date.now() - 60_000;
  hits.set(key, hits.get(key)!.filter((t) => t > cutoff));
}

export function isLikelyLimited(key: string): boolean {
  const recent = hits.get(key);
  if (!recent) return false;
  return recent.filter((t) => t > Date.now() - 60_000).length >= 2;
}

export function getBackoffMs(key: string): number {
  const recent = hits.get(key);
  if (!recent) return 1000;
  const count = recent.filter((t) => t > Date.now() - 60_000).length;
  if (count >= 4) return 30_000;
  if (count >= 3) return 20_000;
  return 10_000;
}
