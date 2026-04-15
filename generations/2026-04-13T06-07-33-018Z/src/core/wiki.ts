// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// The wiki layer. Pattern adapted from Karpathy's LLM Wiki (Memex, 1945).
//
// Raw sources  = journal + memory graph (immutable episodic stream)
// Wiki         = synthesized, cross-referenced concept/entity pages
// Schema       = base.md + reflect.md + dream.md (how the wiki is maintained)
//
// Humans abandon wikis because maintenance grows faster than value.
// The agent does not. SLEEP consolidation is when wiki pages get created
// and updated — the agent does not have to remember to do it consciously.
// During REFLECT the agent may consciously edit a page if it has reason.
// ===========================================================================

import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "fs/promises";
import { basename, join } from "path";
import {
  WIKI_CONCEPTS_DIR,
  WIKI_DIR,
  WIKI_ENTITIES_DIR,
  WIKI_INDEX,
  WIKI_LOG,
  WIKI_SELF,
} from "../primitives/paths.js";

// ── Types ────────────────────────────────────────────────────────────────

export type WikiKind = "concept" | "entity" | "self" | "meta";

export type WikiPageFrontmatter = {
  slug: string;
  kind: WikiKind;
  title: string;
  created_at: string;
  updated_at: string;
  // Source memory/journal ids that contributed to this page. Lets us trace
  // a wiki page back to the raw thoughts it was compiled from.
  sources?: string[];
  // Slugs of other wiki pages this page references.
  related?: string[];
  // Free-text: the reason the page was last revised.
  reason?: string;
  // #12: Confidence score (0-1, default 0.5). Incremented by 0.1 each time
  // the page is updated during sleep consolidation, capped at 1.0.
  confidence?: number;
};

export type WikiPage = {
  frontmatter: WikiPageFrontmatter;
  body: string;
  path: string;
};

// Shared regex for [[wikilink]] detection — used in writePage and lintWiki.
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

// ── Slug / path helpers ──────────────────────────────────────────────────

// A safe filename. Lowercases, replaces non-alphanumerics with dashes.
// Preserves hangul / CJK because many pages will have non-ASCII titles.
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}\-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function dirForKind(kind: WikiKind): string {
  switch (kind) {
    case "concept":
      return WIKI_CONCEPTS_DIR;
    case "entity":
      return WIKI_ENTITIES_DIR;
    case "self":
      return WIKI_DIR; // self lives at the top
    case "meta":
      return WIKI_DIR;
  }
}

function pathForPage(kind: WikiKind, slug: string): string {
  if (kind === "self") return WIKI_SELF;
  return join(dirForKind(kind), `${slug}.md`);
}

// ── Frontmatter serialize/parse (YAML-lite) ──────────────────────────────

function serializeFrontmatter(fm: WikiPageFrontmatter): string {
  const lines = [
    "---",
    `slug: ${fm.slug}`,
    `kind: ${fm.kind}`,
    `title: ${JSON.stringify(fm.title)}`,
    `created_at: ${fm.created_at}`,
    `updated_at: ${fm.updated_at}`,
  ];
  if (fm.sources && fm.sources.length > 0) {
    lines.push(`sources: ${JSON.stringify(fm.sources)}`);
  }
  if (fm.related && fm.related.length > 0) {
    lines.push(`related: ${JSON.stringify(fm.related)}`);
  }
  if (fm.reason) {
    lines.push(`reason: ${JSON.stringify(fm.reason)}`);
  }
  if (fm.confidence != null) {
    lines.push(`confidence: ${fm.confidence}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function parseFrontmatter(text: string): {
  fm: WikiPageFrontmatter | null;
  body: string;
} {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: null, body: text };
  const rawFm = match[1];
  const body = match[2].trim();

  const obj: Record<string, unknown> = {};
  for (const line of rawFm.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    // Try to parse JSON for arrays/quoted strings, else raw string.
    if (value.startsWith("[") || value.startsWith('"')) {
      try {
        obj[key] = JSON.parse(value);
      } catch {
        obj[key] = value;
      }
    } else {
      obj[key] = value;
    }
  }

  if (!obj.slug || !obj.kind || !obj.title) {
    return { fm: null, body };
  }

  return {
    fm: {
      slug: String(obj.slug),
      kind: obj.kind as WikiKind,
      title: String(obj.title),
      created_at: String(obj.created_at || new Date().toISOString()),
      updated_at: String(obj.updated_at || new Date().toISOString()),
      sources: Array.isArray(obj.sources) ? (obj.sources as string[]) : undefined,
      related: Array.isArray(obj.related) ? (obj.related as string[]) : undefined,
      reason: obj.reason ? String(obj.reason) : undefined,
      confidence: obj.confidence != null ? Number(obj.confidence) : undefined,
    },
    body,
  };
}

// ── Read/write ───────────────────────────────────────────────────────────

export async function readPage(kind: WikiKind, slug: string): Promise<WikiPage | null> {
  const path = pathForPage(kind, slug);
  try {
    const text = await readFile(path, "utf-8");
    const { fm, body } = parseFrontmatter(text);
    if (!fm) return null;
    return { frontmatter: fm, body, path };
  } catch {
    return null;
  }
}

export async function writePage(args: {
  kind: WikiKind;
  slug: string;
  title: string;
  body: string;
  sources?: string[];
  related?: string[];
  reason?: string;
  /** #12: If true, increment confidence (used by sleep consolidation). */
  sleepConsolidation?: boolean;
}): Promise<{ created: boolean; path: string; warning?: string }> {
  const path = pathForPage(args.kind, args.slug);
  await mkdir(dirForKind(args.kind), { recursive: true });

  const existing = await readPage(args.kind, args.slug);
  const now = new Date().toISOString();

  // #12: Compute confidence. New pages start at 0.5. Sleep consolidation
  // increments by 0.1, capped at 1.0.
  let confidence = existing?.frontmatter.confidence ?? 0.5;
  if (args.sleepConsolidation && existing) {
    confidence = Math.min(1.0, Math.round((confidence + 0.1) * 100) / 100);
  }

  // #12: Warn if agent tries to completely rewrite a high-confidence page.
  let warning: string | undefined;
  if (
    existing &&
    (existing.frontmatter.confidence ?? 0.5) > 0.8 &&
    !args.sleepConsolidation
  ) {
    warning =
      `Warning: page "${args.slug}" has high confidence (${existing.frontmatter.confidence}). ` +
      `Complete rewrites of settled pages may lose accumulated knowledge.`;
  }

  // #40: Auto cross-reference. Scan the body for [[wikilink]] patterns and
  // mentions of other existing page titles. Add discovered slugs to related.
  const incomingRelated = new Set<string>(args.related ?? existing?.frontmatter.related ?? []);
  try {
    const allPages = await listPages();
    // Scan for [[wikilinks]]
    for (const match of args.body.matchAll(WIKILINK_RE)) {
      const linkSlug = slugify(match[1].trim());
      if (linkSlug && linkSlug !== args.slug) {
        incomingRelated.add(linkSlug);
      }
    }
    // Scan for mentions of existing page titles in the body text
    const bodyLower = args.body.toLowerCase();
    for (const page of allPages) {
      if (page.slug === args.slug) continue;
      if (bodyLower.includes(page.title.toLowerCase())) {
        incomingRelated.add(page.slug);
      }
    }
  } catch {
    // Non-fatal: if listing pages fails, skip auto cross-ref
  }
  const mergedRelated = [...incomingRelated].filter(Boolean);

  const fm: WikiPageFrontmatter = {
    slug: args.slug,
    kind: args.kind,
    title: args.title,
    created_at: existing?.frontmatter.created_at ?? now,
    updated_at: now,
    sources: args.sources ?? existing?.frontmatter.sources,
    related: mergedRelated.length > 0 ? mergedRelated : undefined,
    reason: args.reason,
    confidence,
  };

  const content = `${serializeFrontmatter(fm)}\n\n${args.body.trim()}\n`;
  await writeFile(path, content, "utf-8");

  // Log the event.
  await appendLog({
    ts: now,
    kind: existing ? "update" : "create",
    target: `${args.kind}/${args.slug}`,
    note: args.reason,
  });

  return { created: !existing, path, warning };
}

// ── List pages ───────────────────────────────────────────────────────────

export type WikiPageSummary = {
  slug: string;
  kind: WikiKind;
  title: string;
  updated_at: string;
  path: string;
};

async function listDir(dir: string, kind: WikiKind): Promise<WikiPageSummary[]> {
  const out: WikiPageSummary[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    // Skip special top-level files when listing the wiki root as meta
    if (kind === "meta") {
      const base = basename(name, ".md");
      if (base === "index" || base === "log" || base === "self") continue;
    }
    const full = join(dir, name);
    try {
      const text = await readFile(full, "utf-8");
      const { fm } = parseFrontmatter(text);
      if (!fm) continue;
      out.push({
        slug: fm.slug,
        kind: fm.kind,
        title: fm.title,
        updated_at: fm.updated_at,
        path: full,
      });
    } catch {
      // skip broken files
    }
  }
  return out;
}

export async function listPages(options?: {
  kind?: WikiKind;
}): Promise<WikiPageSummary[]> {
  const pages: WikiPageSummary[] = [];
  if (!options?.kind || options.kind === "concept") {
    pages.push(...(await listDir(WIKI_CONCEPTS_DIR, "concept")));
  }
  if (!options?.kind || options.kind === "entity") {
    pages.push(...(await listDir(WIKI_ENTITIES_DIR, "entity")));
  }
  if (!options?.kind || options.kind === "self") {
    try {
      await stat(WIKI_SELF);
      const text = await readFile(WIKI_SELF, "utf-8");
      const { fm } = parseFrontmatter(text);
      if (fm) {
        pages.push({
          slug: fm.slug,
          kind: "self",
          title: fm.title,
          updated_at: fm.updated_at,
          path: WIKI_SELF,
        });
      }
    } catch {
      // no self page yet
    }
  }
  pages.sort((a, b) => a.slug.localeCompare(b.slug));
  return pages;
}

// ── Index rebuild ────────────────────────────────────────────────────────

// Rebuild index.md from scratch by walking the wiki directory. Cheap.
export async function rebuildIndex(): Promise<{ count: number; path: string }> {
  const pages = await listPages();
  const grouped: Record<WikiKind, WikiPageSummary[]> = {
    self: [],
    concept: [],
    entity: [],
    meta: [],
  };
  for (const p of pages) grouped[p.kind].push(p);

  const lines: string[] = [
    "# Wiki Index",
    "",
    `_last rebuilt ${new Date().toISOString()}_`,
    "",
    `_${pages.length} page(s) total_`,
    "",
  ];

  if (grouped.self.length > 0) {
    lines.push("## self");
    lines.push("");
    for (const p of grouped.self) {
      lines.push(`- [${p.title}](self.md) — updated ${p.updated_at}`);
    }
    lines.push("");
  }

  if (grouped.concept.length > 0) {
    lines.push("## concepts");
    lines.push("");
    for (const p of grouped.concept) {
      lines.push(
        `- [${p.title}](concepts/${p.slug}.md) — updated ${p.updated_at}`,
      );
    }
    lines.push("");
  }

  if (grouped.entity.length > 0) {
    lines.push("## entities");
    lines.push("");
    for (const p of grouped.entity) {
      lines.push(
        `- [${p.title}](entities/${p.slug}.md) — updated ${p.updated_at}`,
      );
    }
    lines.push("");
  }

  if (pages.length === 0) {
    lines.push("_(no pages yet — the wiki will grow as you live and reflect)_");
    lines.push("");
  }

  await mkdir(WIKI_DIR, { recursive: true });
  await writeFile(WIKI_INDEX, lines.join("\n"), "utf-8");

  return { count: pages.length, path: WIKI_INDEX };
}

// ── Lint ─────────────────────────────────────────────────────────────────
//
// Health check for the wiki. Cheap, no LLM calls — pure graph analysis.
// Runs during SLEEP and optionally via a tool the agent can call.
//
// Checks:
//   orphan         — page that no other page references via `related` or [[link]]
//   stale          — page not updated in STALE_DAYS days (default 30)
//   broken-link    — [[wikilink]] inside a body pointing at a nonexistent slug
//   lonely         — concept page with no sources recorded

const STALE_DAYS_DEFAULT = 30;

export type LintFinding = {
  kind: "orphan" | "stale" | "broken-link" | "lonely" | "contradiction";
  slug: string;
  pageKind: WikiKind;
  detail: string;
};

export type LintReport = {
  totalPages: number;
  findings: LintFinding[];
  summary: string;
};

export async function lintWiki(options?: { staleDays?: number }): Promise<LintReport> {
  const staleDays = options?.staleDays ?? STALE_DAYS_DEFAULT;
  const staleThresholdMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const pages = await listPages();
  const findings: LintFinding[] = [];

  const slugSet = new Set(pages.map((p) => p.slug));
  const inbound = new Map<string, number>();
  for (const p of pages) inbound.set(p.slug, 0);

  for (const p of pages) {
    let text: string;
    try {
      text = await readFile(p.path, "utf-8");
    } catch {
      continue;
    }
    const { fm, body } = parseFrontmatter(text);
    if (!fm) continue;

    for (const r of fm.related ?? []) {
      inbound.set(r, (inbound.get(r) ?? 0) + 1);
    }

    // Count [[wikilink]] refs — use matchAll to iterate.
    for (const match of body.matchAll(WIKILINK_RE)) {
      const linkSlug = slugify(match[1].trim());
      if (slugSet.has(linkSlug)) {
        inbound.set(linkSlug, (inbound.get(linkSlug) ?? 0) + 1);
      } else {
        findings.push({
          kind: "broken-link",
          slug: p.slug,
          pageKind: p.kind,
          detail: `[[${match[1]}]] → ${linkSlug} (no such page)`,
        });
      }
    }

    const updatedMs = Date.parse(fm.updated_at);
    if (Number.isFinite(updatedMs) && updatedMs < staleThresholdMs) {
      const ageDays = Math.floor((Date.now() - updatedMs) / (24 * 60 * 60 * 1000));
      findings.push({
        kind: "stale",
        slug: p.slug,
        pageKind: p.kind,
        detail: `not updated in ${ageDays}d (threshold ${staleDays}d)`,
      });
    }

    if (p.kind === "concept" && (!fm.sources || fm.sources.length === 0)) {
      findings.push({
        kind: "lonely",
        slug: p.slug,
        pageKind: p.kind,
        detail: "no sources recorded — was this page compiled from real memories?",
      });
    }
  }

  for (const p of pages) {
    if (p.kind === "self") continue;
    const count = inbound.get(p.slug) ?? 0;
    if (count === 0) {
      findings.push({
        kind: "orphan",
        slug: p.slug,
        pageKind: p.kind,
        detail: "no inbound references",
      });
    }
  }

  // #37: Wiki Contradiction Detection. For each pair of pages that share
  // `related` slugs, do a basic keyword overlap check. If two pages use
  // opposing language about the same topic (same nouns but one has negation
  // words while the other affirms), flag as potential contradiction.
  const NEGATION_RE = /\b(?:not|never|no longer|isn't|aren't|wasn't|doesn't|don't|cannot|can't|won't|wrong|incorrect|false)\b/i;

  // Build a map of related slug -> list of page indices that reference it.
  const relatedIndex = new Map<string, number[]>();
  const pageData: { slug: string; kind: WikiKind; body: string; nouns: string[] }[] = [];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    let text: string;
    try {
      text = await readFile(p.path, "utf-8");
    } catch {
      pageData.push({ slug: p.slug, kind: p.kind, body: "", nouns: [] });
      continue;
    }
    const { fm, body } = parseFrontmatter(text);
    // Extract nouns: words >= 4 chars, lowercased
    const nouns = [...new Set(
      body.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4),
    )];
    pageData.push({ slug: p.slug, kind: p.kind, body, nouns });

    if (fm?.related) {
      for (const rel of fm.related) {
        if (!relatedIndex.has(rel)) relatedIndex.set(rel, []);
        relatedIndex.get(rel)!.push(i);
      }
    }
  }

  // Check pairs that share a related slug
  const checkedPairs = new Set<string>();
  for (const indices of relatedIndex.values()) {
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const ia = indices[a];
        const ib = indices[b];
        const pairKey = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);

        const pa = pageData[ia];
        const pb = pageData[ib];
        if (!pa.body || !pb.body) continue;

        // Find shared nouns
        const sharedNouns = pa.nouns.filter((n) => pb.nouns.includes(n));
        if (sharedNouns.length < 2) continue;

        // Check if one page negates near a shared noun while the other affirms
        for (const noun of sharedNouns.slice(0, 10)) {
          const nounIdx_a = pa.body.toLowerCase().indexOf(noun);
          const nounIdx_b = pb.body.toLowerCase().indexOf(noun);
          if (nounIdx_a === -1 || nounIdx_b === -1) continue;

          const windowA = pa.body.slice(
            Math.max(0, nounIdx_a - 60),
            Math.min(pa.body.length, nounIdx_a + noun.length + 60),
          );
          const windowB = pb.body.slice(
            Math.max(0, nounIdx_b - 60),
            Math.min(pb.body.length, nounIdx_b + noun.length + 60),
          );

          const aNeg = NEGATION_RE.test(windowA);
          const bNeg = NEGATION_RE.test(windowB);
          if (aNeg !== bNeg) {
            findings.push({
              kind: "contradiction",
              slug: pa.slug,
              pageKind: pa.kind,
              detail: `potential contradiction with "${pb.slug}" on term "${noun}" — one negates, the other affirms`,
            });
            break; // one finding per pair is enough
          }
        }
      }
    }
  }

  if (findings.length > 0) {
    await appendLog({
      ts: new Date().toISOString(),
      kind: "lint",
      target: "wiki",
      note: `${findings.length} finding(s): ${findings
        .slice(0, 5)
        .map((f) => `${f.kind}@${f.slug}`)
        .join(", ")}${findings.length > 5 ? "..." : ""}`,
    });
  }

  return {
    totalPages: pages.length,
    findings,
    summary:
      findings.length === 0
        ? `${pages.length} pages, all healthy`
        : `${pages.length} pages, ${findings.length} finding(s): ${["orphan", "stale", "broken-link", "lonely", "contradiction"]
            .map((k) => `${findings.filter((f) => f.kind === k).length} ${k}`)
            .join(", ")}`,
  };
}

// ── Log (chronological) ──────────────────────────────────────────────────

export async function appendLog(args: {
  ts: string;
  kind: "create" | "update" | "lint" | "delete";
  target: string;
  note?: string;
}): Promise<void> {
  await mkdir(WIKI_DIR, { recursive: true });
  const date = args.ts.slice(0, 10); // YYYY-MM-DD
  const line = `## [${date}] ${args.kind} | ${args.target}${args.note ? ` — ${args.note}` : ""}\n`;
  try {
    await stat(WIKI_LOG);
  } catch {
    // First-time: write header
    await writeFile(
      WIKI_LOG,
      "# Wiki Log\n\nChronological record of wiki mutations.\nFormat: `## [YYYY-MM-DD] <kind> | <target> — <note>`\n\n",
      "utf-8",
    );
  }
  await appendFile(WIKI_LOG, line, "utf-8");
}

// ── Initialization ───────────────────────────────────────────────────────

// Called lazily — creates the directory structure and placeholder files
// if they don't exist. Idempotent.
export async function ensureWikiInitialized(): Promise<void> {
  await mkdir(WIKI_DIR, { recursive: true });
  await mkdir(WIKI_CONCEPTS_DIR, { recursive: true });
  await mkdir(WIKI_ENTITIES_DIR, { recursive: true });
  // Ensure index exists
  try {
    await stat(WIKI_INDEX);
  } catch {
    await rebuildIndex();
  }
}
