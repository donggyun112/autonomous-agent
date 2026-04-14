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

import { thinkAux } from "../llm/client.js";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { DATA } from "../primitives/paths.js";
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
import { readRecent, readToday } from "../memory/journal.js";
import { reconstitute, revise } from "./identity.js";
import {
  loadState,
  resetAfterSleep,
  saveState,
  transition,
} from "./state.js";
import {
  appendLog,
  ensureWikiInitialized,
  lintWiki,
  listPages,
  readPage,
  repairWiki,
  rebuildIndex,
  slugify,
  writePage,
} from "./wiki.js";

export type SleepReport = {
  memoriesIngested: number;
  dreamed: number;
  schemasFormed: number;
  associationsFound: number;
  pruned: number;
  whoAmIUpdated: boolean;
  wikiPagesTouched: number;
  wikiLintFindings: number;
  selfPageSynced: boolean;
  entityPagesCreated: number;
  durationMs: number;
  errors: Array<{ step: string; message: string }>;
};

const DREAM_BATCH_SIZE = 5;
const CLUSTER_LIMIT = 3;
const ASSOCIATION_TRIES = 3;

// Compress a single memory's content via LLM.
async function compressMemory(content: string): Promise<string> {
  const result = await thinkAux({
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

  const result = await thinkAux({
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
  const result = await thinkAux({
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
    sleepConsolidation: true,
  });
  return true;
}

// Extract today's main thread from journal entries and append it to whoAmI.
async function integrateJournal(): Promise<boolean> {
  const recent = await readRecent(1);
  if (!recent.trim()) return false;

  const currentWhoAmI = await reconstitute();

  const result = await thinkAux({
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
    memoriesIngested: 0,
    dreamed: 0,
    schemasFormed: 0,
    associationsFound: 0,
    pruned: 0,
    whoAmIUpdated: false,
    wikiPagesTouched: 0,
    wikiLintFindings: 0,
    selfPageSynced: false,
    entityPagesCreated: 0,
    durationMs: 0,
    errors: [],
  };

  // Ensure wiki directory exists before SLEEP operations touch it.
  try {
    await ensureWikiInitialized();
  } catch (err) {
    report.errors.push({ step: "wiki-init", message: (err as Error).message });
  }

  // 0. Ingest today's journal entries into the memory graph.
  // LLM-based key extraction: the sleeping mind reads each entry and picks
  // meaningful concept keys (not static tokenization). This is the Hermes
  // pattern — keys determine recall quality, so they deserve LLM attention.
  const cursorFile = join(DATA, ".ingest-cursor");
  try {
    const todayText = await readToday();
    if (todayText) {
      let cursor = "";
      try { cursor = (await readFile(cursorFile, "utf-8")).trim(); } catch { /* no cursor yet */ }

      const entries = todayText.split(/\n(?=## \d{4}-\d{2}-\d{2}T)/).filter((e) => e.trim());

      // Batch entries for LLM key extraction (max 5 at a time to save tokens)
      const toIngest: Array<{ text: string; entryTs: string }> = [];
      for (const entry of entries) {
        const tsMatch = entry.match(/^## (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
        const entryTs = tsMatch ? tsMatch[1] : "";
        if (cursor && entryTs && entryTs <= cursor) continue;
        const text = entry.replace(/^## \d{4}-\d{2}-\d{2}T[\d:.]+Z[^\n]*\n/, "").trim();
        if (!text || text.length < 10) continue;
        toIngest.push({ text, entryTs });
      }

      // Process in batches
      const BATCH_SIZE = 5;
      for (let i = 0; i < toIngest.length; i += BATCH_SIZE) {
        const batch = toIngest.slice(i, i + BATCH_SIZE);
        const batchTexts = batch.map((b, idx) => `[${idx}] ${b.text.slice(0, 500)}`).join("\n\n");

        // LLM extracts keys for each entry in the batch
        let keysByEntry: string[][] = [];
        try {
          const keyResult = await thinkAux({
            systemPrompt:
              "You are the agent's sleeping mind. You read journal entries and extract " +
              "3-6 concept keys per entry. Keys should be meaningful nouns or noun phrases " +
              "that would help recall this memory later. NOT timestamps, NOT mode names " +
              "(WAKE/REFLECT/SLEEP), NOT generic words (도구/행동/생각). " +
              "Focus on: specific tool names, concrete outcomes, decisions made, errors encountered, " +
              "concepts learned, people/systems mentioned. " +
              "Respond as JSON array of arrays: [[\"key1\",\"key2\",...], [\"key1\",...], ...]",
            messages: [{ role: "user", content: batchTexts }],
            maxTokens: 300,
          });
          // Parse JSON response
          const parsed = JSON.parse(
            keyResult.text.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, ""),
          );
          if (Array.isArray(parsed)) keysByEntry = parsed;
        } catch {
          // Fallback: use static extraction if LLM fails
          const { extractKeys } = await import("../memory/keys.js");
          keysByEntry = batch.map(b => extractKeys(b.text));
        }

        // Ingest each entry with its LLM-extracted keys
        for (let j = 0; j < batch.length; j++) {
          const { text, entryTs } = batch[j];
          let keys = keysByEntry[j] ?? [];
          if (!Array.isArray(keys) || keys.length === 0) {
            // Fallback
            const { extractKeys } = await import("../memory/keys.js");
            keys = extractKeys(text);
          }
          // Ensure all keys are strings
          keys = keys.filter((k): k is string => typeof k === "string" && k.length > 1);
          if (keys.length === 0) keys.push("thought");

          try {
            await remember(text, keys);
            report.memoriesIngested += 1;
            if (entryTs) await writeFile(cursorFile, entryTs, "utf-8");
          } catch {
            // skip individual failures
          }
        }
      }
      try { await rm(cursorFile); } catch { /* ok */ }
    }
  } catch (err) {
    report.errors.push({ step: "journal-ingest", message: (err as Error).message });
  }

  // 1. Dream — REMOVED. Agent manages memory compression directly via
  // memory_manage tool during REFLECT (Hermes pattern).

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
        let existing = candidateSlug ? await readPage("concept", candidateSlug) : null;

        // Dedup: if no exact slug match, check if any existing page covers
        // the same topic (shared key words in title). Merge into that page
        // instead of creating a duplicate.
        const allPages = await listPages({ kind: "concept" });
        if (!existing) {
          const clusterKeyLower = cluster.keys.map(k => k.toLowerCase());
          for (const p of allPages) {
            const titleWords = p.title.toLowerCase().split(/\s+/);
            const overlap = clusterKeyLower.filter(k => titleWords.some(tw => tw.includes(k) || k.includes(tw)));
            if (overlap.length >= 2 || (overlap.length >= 1 && clusterKeyLower.length <= 2)) {
              existing = await readPage("concept", p.slug);
              break;
            }
          }
        }

        const page = await extractSchemaAsPage({
          keys: cluster.keys,
          contents: cluster.contents,
          existingPageBody: existing?.body,
        });
        if (!page) continue;

        // If we found an existing page to merge into, use its slug.
        if (existing && existing.frontmatter.slug !== page.slug) {
          page.slug = existing.frontmatter.slug;
        }
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
          sleepConsolidation: true,
        });
        report.schemasFormed += 1;
        report.wikiPagesTouched += 1;
      } catch (err) {
        report.errors.push({ step: "cluster-schema", message: (err as Error).message });
      }
    }
  } catch (err) {
    report.errors.push({ step: "cluster", message: (err as Error).message });
  }

  // 2b. Entity page auto-generation. Scan today's journal for capitalized
  // proper nouns (words starting with uppercase that aren't sentence starters,
  // appearing 2+ times). For each, check if an entity wiki page exists.
  // If not, create a stub entity page.
  try {
    const todayText = await readToday();
    if (todayText) {
      // Find capitalized words that aren't sentence starters.
      // We look for words preceded by a non-sentence-boundary character
      // (i.e., not at the very start or after . ! ? newline).
      const properNounMatches = todayText.match(
        /(?<=[a-z,;:]\s)[A-Z][a-z]{2,}/g,
      ) ?? [];
      // Count occurrences
      const counts = new Map<string, number>();
      for (const word of properNounMatches) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
      // Filter to those appearing 2+ times
      const candidates = [...counts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([word]) => word);

      for (const name of candidates) {
        const entitySlug = slugify(name);
        if (!entitySlug) continue;
        const existing = await readPage("entity", entitySlug);
        if (existing) continue; // already exists

        await writePage({
          kind: "entity",
          slug: entitySlug,
          title: name,
          body: `Stub page for entity "${name}". Mentioned ${counts.get(name)} times in today's journal. This page will be enriched as more is learned.`,
          reason: "sleep: auto-generated entity stub from journal proper nouns",
          sleepConsolidation: true,
        });
        report.entityPagesCreated += 1;
        report.wikiPagesTouched += 1;
      }
    }
  } catch (err) {
    report.errors.push({ step: "entity-auto-gen", message: (err as Error).message });
  }

  // 3. REM association — REMOVED. Agent links memories via memory_manage tool.
  // 4. Prune — REMOVED. Agent decides what to delete via memory_manage tool.

  // 5. Integrate journal into whoAmI.
  try {
    report.whoAmIUpdated = await integrateJournal();
  } catch (err) {
    report.errors.push({ step: "integrate-journal", message: (err as Error).message });
  }

  // 5b. Sync wiki/self.md with the (possibly just-updated) whoAmI and
  // cross-reference the top concept pages. This runs AFTER integrateJournal
  // so the self page reflects the freshest view.
  try {
    report.selfPageSynced = await syncSelfPage();
  } catch (err) {
    report.errors.push({ step: "sync-self-page", message: (err as Error).message });
  }

  // 5c. Rebuild wiki index (cheap, keeps the catalog current).
  try {
    await rebuildIndex();
  } catch (err) {
    report.errors.push({ step: "rebuild-index", message: (err as Error).message });
  }

  // 5d. Normalize wiki references and backfill missing source links using
  // local memory data, then rebuild the index if anything changed.
  try {
    const repair = await repairWiki({ sleepConsolidation: true });
    report.wikiPagesTouched += repair.pagesTouched;
    if (repair.pagesTouched > 0) {
      await rebuildIndex();
    }
  } catch (err) {
    report.errors.push({ step: "wiki-repair", message: (err as Error).message });
  }

  // 5e. Lint the wiki. Findings are logged; the agent can read the wiki
  // log later and decide whether to address them during REFLECT.
  try {
    const lint = await lintWiki({ includeContradictions: false });
    report.wikiLintFindings = lint.findings.length;
  } catch (err) {
    report.errors.push({ step: "wiki-lint", message: (err as Error).message });
  }

  // 5f. Generate wake handoff — practical summary for next WAKE.
  // Not a dream journal. A briefing: what was done, what failed, what's next.
  try {
    const todayJournal = await readToday();
    const { readRecentActions: readActionsForHandoff } = await import("./action-log.js");
    const todayActions = await readActionsForHandoff(1);
    const errorCount = todayActions.filter(a => a.error).length;
    const toolCounts: Record<string, number> = {};
    for (const a of todayActions) toolCounts[a.tool] = (toolCounts[a.tool] ?? 0) + 1;
    const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const curiosityFile = join(DATA, "curiosity.md");
    let curiosity = "";
    try { curiosity = await readFile(curiosityFile, "utf-8"); } catch { /* ok */ }

    const handoffResult = await thinkAux({
      systemPrompt:
        "You write a practical wake briefing for an autonomous engineering agent. " +
        "Format: 3 sections, each 1-3 lines. No poetry. No philosophy. " +
        "1) DONE: what was accomplished today (concrete outputs) " +
        "2) FAILED: what went wrong and why " +
        "3) NEXT: the single most important thing to do when you wake up. Be specific. " +
        "Write in Korean. Total under 200 words.",
      messages: [{
        role: "user",
        content: [
          `Today's journal (last 2000 chars):\n${todayJournal.slice(-2000)}`,
          `Actions: ${todayActions.length} total, ${errorCount} errors`,
          `Top tools: ${topTools.map(([t, n]) => `${t}(${n})`).join(", ")}`,
          `Sleep report: ${JSON.stringify({ memoriesIngested: report.memoriesIngested, dreamed: report.dreamed, schemasFormed: report.schemasFormed, pruned: report.pruned })}`,
          curiosity ? `Self-assigned next task: ${curiosity}` : "",
        ].filter(Boolean).join("\n\n"),
      }],
      maxTokens: 400,
    });
    const handoffPath = join(DATA, "wake-handoff.md");
    await mkdir(DATA, { recursive: true });
    await writeFile(handoffPath, handoffResult.text.trim() + "\n", "utf-8");
  } catch (err) {
    report.errors.push({ step: "wake-handoff", message: (err as Error).message });
  }

  // 5g. Auto-skill extraction from action patterns.
  // Analyze today's action log for repeated tool sequences and extract
  // reusable skills as ritual files (Hermes "autonomous skill creation" pattern).
  try {
    const { readRecentActions } = await import("./action-log.js");
    const actions = await readRecentActions(1);
    if (actions.length >= 5) {
      // Find repeated tool sequences (2+ occurrences of same 2-tool pattern)
      const pairs: Record<string, number> = {};
      for (let i = 0; i < actions.length - 1; i++) {
        const pair = `${actions[i].tool}→${actions[i + 1].tool}`;
        pairs[pair] = (pairs[pair] ?? 0) + 1;
      }
      const repeated = Object.entries(pairs)
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      if (repeated.length > 0) {
        const patternsText = repeated
          .map(([pair, count]) => `- ${pair} (${count} times)`)
          .join("\n");

        // Ask LLM to extract a skill from the pattern
        const skillResult = await thinkAux({
          systemPrompt:
            "You are analyzing an agent's action patterns to extract reusable skills. " +
            "Given repeated tool sequences, write a skill file in markdown with YAML frontmatter. " +
            "Format:\n---\nname: skill-name\ndescription: what and when\nschedule: always\nmode: WAKE\n---\n\n## Process\n1. step\n2. step\n\n" +
            "If the patterns are trivial (just journal+recall loops), respond with NO_SKILL. " +
            "Only extract genuinely useful procedures.",
          messages: [{
            role: "user",
            content: `Today's repeated tool patterns:\n${patternsText}\n\nTotal actions: ${actions.length}\nTop tools: ${
              Object.entries(actions.reduce((acc: Record<string, number>, a) => {
                acc[a.tool] = (acc[a.tool] ?? 0) + 1;
                return acc;
              }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${t}(${n})`).join(", ")
            }\n\nExtract a reusable skill if the pattern is meaningful.`,
          }],
          maxTokens: 512,
        });

        const skillText = skillResult.text.trim();
        if (skillText && skillText !== "NO_SKILL" && skillText.includes("---")) {
          // Extract skill name from frontmatter
          const nameMatch = skillText.match(/name:\s*(.+)/);
          const skillName = nameMatch
            ? nameMatch[1].trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase()
            : `auto-skill-day-${report.memoriesIngested}`;
          const { SRC: srcDir } = await import("../primitives/paths.js");
          const skillPath = join(srcDir, "extensions", "rituals", `${skillName}.md`);

          // Only create if doesn't already exist
          const { stat: statAsync } = await import("fs/promises");
          try {
            await statAsync(skillPath);
            // Already exists — skip
          } catch {
            await writeFile(skillPath, skillText, "utf-8");
            report.wikiPagesTouched += 1; // reuse counter for skill creation
          }
        }
      }
    }
  } catch (err) {
    report.errors.push({ step: "skill-extraction", message: (err as Error).message });
  }

  // 5h. Keep/discard rule for extension tools (AutoAgent pattern).
  // Tools that haven't been used in 5+ days get flagged. Tools unused for
  // 10+ days get auto-deleted. Usage is tracked via action-log.
  try {
    const { readRecentActions } = await import("./action-log.js");
    const { readdir: readdirAsync, rm: rmAsync, stat: statAsync, writeFile: writeFileAsync } = await import("fs/promises");
    const { SRC: srcDir } = await import("../primitives/paths.js");
    const extToolsDir = join(srcDir, "extensions", "tools");
    const recentActions = await readRecentActions(10); // last 10 days
    const usedTools = new Set(recentActions.map(a => a.tool));

    try {
      const toolFiles = (await readdirAsync(extToolsDir))
        .filter(f => f.endsWith(".ts") && f !== "README.md");
      for (const file of toolFiles) {
        const toolName = file.replace(".ts", "");
        const filePath = join(extToolsDir, file);
        if (!usedTools.has(toolName)) {
          // Check file age
          const fileStat = await statAsync(filePath);
          const ageMs = Date.now() - fileStat.mtimeMs;
          const ageDays = ageMs / (86400000);
          if (ageDays > 10) {
            // Auto-delete unused tool
            await rmAsync(filePath);
            await appendLog({
              ts: new Date().toISOString(),
              kind: "delete",
              target: toolName,
              note: `keep-discard: unused for ${Math.round(ageDays)} days`,
            });
          } else if (ageDays > 5) {
            // Flag for review
            await appendLog({
              ts: new Date().toISOString(),
              kind: "lint",
              target: toolName,
              note: `keep-discard: unused ${Math.round(ageDays)} days, will delete at 10`,
            });
          }
        }
      }
    } catch { /* extensions dir may not exist */ }

    // Same for rituals/skills
    const ritualsDir = join(srcDir, "extensions", "rituals");
    try {
      const ritualFiles = (await readdirAsync(ritualsDir))
        .filter(f => f.endsWith(".md") && f !== "README.md");
      for (const file of ritualFiles) {
        const filePath = join(ritualsDir, file);
        const fileStat = await statAsync(filePath);
        const ageDays = (Date.now() - fileStat.mtimeMs) / 86400000;
        // Skills older than 15 days that are from auto-generation get pruned
        if (ageDays > 15 && file.startsWith("auto-skill-")) {
          await rmAsync(filePath);
          await appendLog({
            ts: new Date().toISOString(),
            kind: "delete",
            target: file,
            note: `keep-discard: auto-generated ritual, unused ${Math.round(ageDays)} days`,
          });
        }
      }
    } catch { /* rituals dir may not exist */ }
  } catch (err) {
    report.errors.push({ step: "keep-discard", message: (err as Error).message });
  }

  // 5i. Failure analysis (AutoAgent pattern).
  // Classify errors from today's action log by root cause, create targeted
  // debug skills for recurring error classes.
  try {
    const { readRecentActions: readActions } = await import("./action-log.js");
    const todayActions = await readActions(1);
    const errors = todayActions.filter(a => a.error);
    if (errors.length >= 2) {
      // Group errors by tool
      const errorsByTool: Record<string, string[]> = {};
      for (const e of errors) {
        if (!errorsByTool[e.tool]) errorsByTool[e.tool] = [];
        errorsByTool[e.tool].push(e.error ?? "unknown");
      }

      // For tools with 2+ errors, generate a debug skill
      for (const [tool, errs] of Object.entries(errorsByTool)) {
        if (errs.length < 2) continue;
        const debugResult = await thinkAux({
          systemPrompt:
            "You analyze recurring tool errors and write a debug skill. " +
            "Format: ---\\nname: debug-TOOLNAME\\ndescription: ...\\nschedule: always\\nmode: WAKE\\n---\\n\\n## When This Fires\\n...\\n## Fix Steps\\n1...\\n2...\\n" +
            "If errors are trivial or random, respond NO_SKILL.",
          messages: [{
            role: "user",
            content: `Tool "${tool}" failed ${errs.length} times today.\nErrors:\n${errs.slice(0, 5).map((e, i) => `${i + 1}. ${e.slice(0, 200)}`).join("\n")}\n\nWrite a debug skill.`,
          }],
          maxTokens: 400,
        });
        const text = debugResult.text.trim();
        if (text && text !== "NO_SKILL" && text.includes("---")) {
          const { SRC: srcDir2 } = await import("../primitives/paths.js");
          const { stat: statCheck } = await import("fs/promises");
          const skillPath = join(srcDir2, "extensions", "rituals", `debug-${tool}.md`);
          try {
            await statCheck(skillPath); // already exists
          } catch {
            await writeFile(skillPath, text, "utf-8");
          }
        }
      }
    }
  } catch (err) {
    report.errors.push({ step: "failure-analysis", message: (err as Error).message });
  }

  // 5j. Compress recent session trajectories.
  try {
    const { compressRecentTrajectories } = await import("./trajectory.js");
    await compressRecentTrajectories(3);
  } catch (err) {
    report.errors.push({ step: "trajectory-compression", message: (err as Error).message });
  }

  // 6. Reset sleep pressure + 7. transition to WAKE.
  let state = await loadState();
  state = resetAfterSleep(state);
  state = await transition(state, "WAKE", "sleep complete");
  await saveState(state);

  // New agent-day: reset log file caches so they pick up the new sleepCount.
  try {
    const { resetActionLogDay } = await import("./action-log.js");
    const { resetSystemLogDay } = await import("./system-log.js");
    resetActionLogDay();
    resetSystemLogDay();
  } catch { /* ok */ }

  report.durationMs = Date.now() - startedAt;
  return report;
}
