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
};

export type WikiPage = {
  frontmatter: WikiPageFrontmatter;
  body: string;
  path: string;
};

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
}): Promise<{ created: boolean; path: string }> {
  const path = pathForPage(args.kind, args.slug);
  await mkdir(dirForKind(args.kind), { recursive: true });

  const existing = await readPage(args.kind, args.slug);
  const now = new Date().toISOString();

  const fm: WikiPageFrontmatter = {
    slug: args.slug,
    kind: args.kind,
    title: args.title,
    created_at: existing?.frontmatter.created_at ?? now,
    updated_at: now,
    sources: args.sources ?? existing?.frontmatter.sources,
    related: args.related ?? existing?.frontmatter.related,
    reason: args.reason,
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

  return { created: !existing, path };
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
