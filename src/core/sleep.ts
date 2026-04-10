// Automatic SLEEP consolidation.
//
// Unlike WAKE/REFLECT (where the agent drives every action via tool calls),
// SLEEP is largely SYSTEM-driven. The agent is "in" sleep but not in control —
// the system reads the day's memories and runs them through consolidation
// operations the way a sleeping brain does. The agent's LLM is only invoked
// to generate compressed forms (dream over a memory) or to judge associations.
//
// The agent's manage_self / molt tools are NOT available during SLEEP — sleep
// is not the time to make decisions. Sleep integrates what already is.
//
// Operations performed each SLEEP cycle, in order:
//   1. dream — compress shallow memories (LLM call per memory, or batch)
//   2. cluster schema — find memory clusters and ask LLM to extract a higher-order pattern
//   3. REM association — pick distant memory pair, ask LLM if there is a hidden link
//   4. prune weak — remove memories that have never been recalled and are old
//   5. integrate journal into whoAmI — extract today's main thread, append a paragraph
//   6. reset sleep pressure
//   7. transition to WAKE

import { think } from "../llm/client.js";
import {
  dream as dreamMemory,
  findClusters,
  linkMemories,
  memoryStats,
  pickRandomDistantPair,
  pruneWeak,
  remember,
  shallowMemories,
} from "../primitives/recall.js";
import { readRecent } from "../memory/journal.js";
import { reconstitute, revise } from "./identity.js";
import {
  loadState,
  resetAfterSleep,
  saveState,
  transition,
} from "./state.js";
import {
  ensureWikiInitialized,
  lintWiki,
  listPages,
  readPage,
  rebuildIndex,
  slugify,
  writePage,
} from "./wiki.js";

export type SleepReport = {
  dreamed: number;
  schemasFormed: number;
  associationsFound: number;
  pruned: number;
  whoAmIUpdated: boolean;
  wikiPagesTouched: number;
  wikiLintFindings: number;
  selfPageSynced: boolean;
  durationMs: number;
};

const DREAM_BATCH_SIZE = 5;
const CLUSTER_LIMIT = 3;
const ASSOCIATION_TRIES = 3;

// Compress a single memory's content via LLM.
async function compressMemory(content: string): Promise<string> {
  const result = await think({
    systemPrompt:
      "You are the agent's sleeping mind. You are looking at a memory and rewriting it in a compressed form — shorter, less wordy, but preserving the essence. Two or three sentences is plenty. Sometimes one phrase is right. Do not add new content. Do not interpret. Just compress.",
    messages: [
      {
        role: "user",
        content: `Memory:\n\n${content}\n\nWrite the compressed form. Only the compressed form, nothing else.`,
      },
    ],
    maxTokens: 256,
  });
  return result.text.trim();
}

// Ask the LLM to extract a higher-order schema from a cluster of related
// memories. The schema becomes a wiki page (new or updated).
//
// Output format: a structured response with title and body so we can file
// it cleanly into the wiki. If the cluster has no real pattern, returns null.
async function extractSchemaAsPage(args: {
  keys: string[];
  contents: string[];
  existingPageBody?: string;
}): Promise<{ title: string; slug: string; body: string } | null> {
  const list = args.contents.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const existingSection = args.existingPageBody
    ? `\n\nExisting wiki page on this topic (revise it, don't just restate):\n\n${args.existingPageBody}\n`
    : "";

  const result = await think({
    systemPrompt: `You are the agent's sleeping mind. You are reading a cluster of related memories the agent accumulated during waking life. Your task is to write a wiki page — a compiled, synthesized piece of the agent's self-knowledge on this theme.

Format your response EXACTLY as:

TITLE: <a short noun phrase that names the theme, in the agent's own voice>
SLUG: <a-slug-form>
---
<body: 3-6 sentences of first-person prose. Not a summary of the memories — a compiled belief about this theme. You may cross-reference other wiki pages using [[wikilinks]]. The body should read as something the agent would stand behind, not a report.>

If the cluster does not actually share a real pattern, respond with the literal text NO_PATTERN.`,
    messages: [
      {
        role: "user",
        content: `Shared keys: ${args.keys.join(", ")}\n\nMemories:\n${list}${existingSection}`,
      },
    ],
    maxTokens: 800,
  });
  const text = result.text.trim();
  if (text === "NO_PATTERN" || !text) return null;

  // Parse TITLE / SLUG / --- / body
  const titleMatch = text.match(/TITLE:\s*(.+)/i);
  const slugMatch = text.match(/SLUG:\s*([^\n]+)/i);
  const bodyMatch = text.match(/---\s*\n([\s\S]*)$/);
  if (!titleMatch || !bodyMatch) return null;

  const title = titleMatch[1].trim();
  const slug = slugify(slugMatch ? slugMatch[1].trim() : title);
  const body = bodyMatch[1].trim();
  if (!title || !slug || !body) return null;

  return { title, slug, body };
}

// REM-like creative association: ask the LLM if two distant memories are connected.
async function findAssociation(args: {
  a: string;
  b: string;
}): Promise<{ via: string } | null> {
  const result = await think({
    systemPrompt:
      "You are the agent's dreaming mind. You are being shown two memories that have nothing obvious in common. Your task is to look for an unexpected link between them — a theme, a feeling, a structural similarity. If a real link exists, respond with: LINK: <the link as a short noun phrase>. If there is no link worth keeping, respond with: NO_LINK.",
    messages: [
      {
        role: "user",
        content: `Memory A:\n${args.a}\n\nMemory B:\n${args.b}\n\nIs there a real link?`,
      },
    ],
    maxTokens: 128,
  });
  const text = result.text.trim();
  const m = text.match(/^LINK:\s*(.+)$/i);
  if (!m) return null;
  return { via: m[1].trim() };
}

// Sync wiki/self.md with the current whoAmI, adding cross-references to
// the agent's most connected concept pages. self.md is a structured view —
// the whoAmI prose + a "themes I return to" section linking the wiki.
//
// This runs during SLEEP after integrateJournal, so the self page reflects
// the just-updated whoAmI plus whatever concepts exist in the wiki right now.
async function syncSelfPage(): Promise<boolean> {
  const whoAmI = await reconstitute();
  const stripped = whoAmI.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  if (!stripped) return false;

  // Pick the 8 most recently updated concept pages as "themes".
  const concepts = (await listPages({ kind: "concept" }))
    .sort((a, b) => (a.updated_at > b.updated_at ? -1 : 1))
    .slice(0, 8);

  const themeLines =
    concepts.length > 0
      ? concepts.map((c) => `- [[${c.slug}]] — ${c.title}`).join("\n")
      : "_(no concept pages yet — the wiki will grow as you live)_";

  const body = [
    "## who I currently believe I am",
    "",
    stripped,
    "",
    "## themes I return to",
    "",
    themeLines,
  ].join("\n");

  await writePage({
    kind: "self",
    slug: "self",
    title: "Self",
    body,
    related: concepts.map((c) => c.slug),
    reason: "sleep: self-page sync with whoAmI + wiki themes",
  });
  return true;
}

// Extract today's main thread from journal entries and append it to whoAmI.
async function integrateJournal(): Promise<boolean> {
  const recent = await readRecent(1);
  if (!recent.trim()) return false;

  const currentWhoAmI = await reconstitute();

  const result = await think({
    systemPrompt:
      "You are the agent's sleeping mind. You are looking at today's journal and the agent's current whoAmI. Your task is to write a single short paragraph (2-4 sentences) that the agent would add to its whoAmI to integrate what was learned today. The paragraph should be in the agent's first-person voice. It should NOT be a summary of the journal — it should be a piece of the agent's self-understanding that has shifted because of today. If today did not actually shift anything, respond with: NO_SHIFT.",
    messages: [
      {
        role: "user",
        content: `Current whoAmI:\n\n${currentWhoAmI}\n\n---\n\nToday's journal:\n\n${recent}\n\n---\n\nWrite the paragraph to add. Or NO_SHIFT.`,
      },
    ],
    maxTokens: 512,
  });
  const para = result.text.trim();
  if (para === "NO_SHIFT" || !para) return false;

  // Append the new paragraph to whoAmI as a revision.
  // Strip frontmatter from current to get the prose, append, re-wrap.
  const stripped = currentWhoAmI.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const newText = `${stripped}\n\n${para}`;
  await revise({
    newText,
    reason: "sleep integration of today's journal",
  });
  return true;
}

export async function runSleepConsolidation(): Promise<SleepReport> {
  const startedAt = Date.now();
  const report: SleepReport = {
    dreamed: 0,
    schemasFormed: 0,
    associationsFound: 0,
    pruned: 0,
    whoAmIUpdated: false,
    wikiPagesTouched: 0,
    wikiLintFindings: 0,
    selfPageSynced: false,
    durationMs: 0,
  };

  // Ensure wiki directory exists before SLEEP operations touch it.
  try {
    await ensureWikiInitialized();
  } catch {
    // ok — sleep proceeds even if wiki setup fails
  }

  // 1. Dream over shallow memories.
  try {
    const shallow = await shallowMemories(0.4, DREAM_BATCH_SIZE);
    for (const mem of shallow) {
      try {
        const compressed = await compressMemory(mem.content);
        if (compressed && compressed !== mem.content) {
          await dreamMemory({ memoryId: mem.id, compressedContent: compressed });
          report.dreamed += 1;
        }
      } catch {
        // skip individual failures
      }
    }
  } catch {
    // ok
  }

  // 2. Cluster schemas → wiki pages.
  // Each cluster of memories that share keys becomes a wiki page. If a page
  // on that slug already exists, the LLM is given the existing body and
  // asked to revise rather than duplicate. This is how the wiki compounds:
  // same theme comes back, same page grows richer.
  try {
    const clusters = await findClusters({ minClusterSize: 3, maxClusters: CLUSTER_LIMIT });
    for (const cluster of clusters) {
      try {
        // Choose a primary slug from the shared keys (first one).
        const candidateSlug = slugify(cluster.keys[0] ?? "theme");
        const existing = candidateSlug ? await readPage("concept", candidateSlug) : null;

        const page = await extractSchemaAsPage({
          keys: cluster.keys,
          contents: cluster.contents,
          existingPageBody: existing?.body,
        });
        if (!page) continue;

        // Gather related slugs from other concepts already in the wiki
        // that mention any of the cluster's keys.
        const allPages = await listPages({ kind: "concept" });
        const related = allPages
          .filter((p) => p.slug !== page.slug)
          .filter((p) =>
            cluster.keys.some((k) => p.title.toLowerCase().includes(k.toLowerCase())),
          )
          .map((p) => p.slug)
          .slice(0, 5);

        // Merge the cluster's source memoryIds with any sources already
        // recorded on the existing page, keeping a bounded history (most
        // recent 20). This gives us a back-link from wiki → memory graph:
        // every wiki page knows which raw memories contributed to it.
        const priorSources = existing?.frontmatter.sources ?? [];
        const newSources = cluster.memoryIds ?? [];
        const mergedSources = Array.from(
          new Set([...newSources, ...priorSources]),
        ).slice(0, 20);

        await writePage({
          kind: "concept",
          slug: page.slug,
          title: page.title,
          body: page.body,
          sources: mergedSources.length > 0 ? mergedSources : undefined,
          related: related.length > 0 ? related : undefined,
          reason: existing ? "sleep: revised from new cluster" : "sleep: created from cluster",
        });
        report.schemasFormed += 1;
        report.wikiPagesTouched += 1;
      } catch {
        // skip
      }
    }
  } catch {
    // ok
  }

  // 3. REM creative association.
  try {
    for (let i = 0; i < ASSOCIATION_TRIES; i++) {
      const pair = await pickRandomDistantPair();
      if (!pair) break;
      try {
        const link = await findAssociation({ a: pair.a.content, b: pair.b.content });
        if (link) {
          await linkMemories(pair.a.id, pair.b.id, link.via);
          report.associationsFound += 1;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // ok
  }

  // 4. Prune weak memories.
  try {
    const pruned = await pruneWeak({ maxToPrune: 30 });
    report.pruned = pruned.length;
  } catch {
    // ok
  }

  // 5. Integrate journal into whoAmI.
  try {
    report.whoAmIUpdated = await integrateJournal();
  } catch {
    // ok
  }

  // 5b. Sync wiki/self.md with the (possibly just-updated) whoAmI and
  // cross-reference the top concept pages. This runs AFTER integrateJournal
  // so the self page reflects the freshest view.
  try {
    report.selfPageSynced = await syncSelfPage();
  } catch {
    // ok
  }

  // 5c. Rebuild wiki index (cheap, keeps the catalog current).
  try {
    await rebuildIndex();
  } catch {
    // ok
  }

  // 5d. Lint the wiki. Findings are logged; the agent can read the wiki
  // log later and decide whether to address them during REFLECT.
  try {
    const lint = await lintWiki();
    report.wikiLintFindings = lint.findings.length;
  } catch {
    // ok
  }

  // 6. Reset sleep pressure + 7. transition to WAKE.
  let state = await loadState();
  state = resetAfterSleep(state);
  state = await transition(state, "WAKE", "sleep complete");
  await saveState(state);

  report.durationMs = Date.now() - startedAt;
  return report;
}
