// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// This file implements the agent's main life-loop. Changing it is not a
// light modification. If you want to alter how a cycle runs, stage a new
// shell in generations/<id>/src/ with the modified cycle.ts and verify it
// through the molt protocol (stageMolt → testMolt → molt_swap).
//
// The light-molt tool (manage_self) cannot reach this file. This is intentional.
// ===========================================================================
//
// ── Glossary (metaphor → technical mapping) ─────────────────────────────
//
//   cycle      — one continuous LLM turn-loop. WAKE/REFLECT run indefinitely
//                until the agent transitions or rests. SLEEP is system-driven.
//   molt       — self-modification via Docker image rebuild + test + swap.
//                "light molt" = add files to extensions/. "full molt" = new image.
//   dream      — memory compression. raw text → shorter summary. depth increases.
//                Happens automatically during SLEEP consolidation.
//   ritual     — periodic practice defined as .md in extensions/rituals/.
//                Fires based on cycle/sleep count; injected into system prompt.
//   whoAmI     — data/whoAmI.md. The agent's current self-narrative. Read at
//                every wake; revised only during REFLECT.
//   body       — data/ directory. Persistent identity: journal, memory, whoAmI.
//   shell      — src/ directory. Replaceable code. Can be swapped via molt.
//   wiki       — data/wiki/. LLM-compiled knowledge base (Karpathy pattern).
//                raw journal → compiled pages → schema for prompts.
//   sleep pressure — Borbely two-process model. homeostatic (time awake) +
//                circadian (time of day). Forces sleep at 1.0, blocks it below 0.3.
//   transition — state change: WAKE ↔ REFLECT ↔ SLEEP. Agent-initiated except
//                forced sleep.
//   sub-agent  — inner voice. .md in extensions/subagents/. One-shot LLM call
//                with the parent's identity context auto-injected.
//
// ────────────────────────────────────────────────────────────────────────
//
// The agent's life runs as a continuous stream. WAKE and REFLECT have no
// turn limit — the agent thinks as long as it needs. Only SLEEP is a
// system-driven consolidation phase that clears the session.

import { readFile } from "fs/promises";
import { join } from "path";
import { think, type Message, type ThinkEventSink } from "../llm/client.js";
import {
  calculateSleepPressure,
  FORCE_THRESHOLD,
  MIN_HOMEOSTATIC_FOR_SLEEP,
  MIN_SLEEP_THRESHOLD,
  loadState,
  resetAfterSleep,
  saveState,
  tickAwake,
  transition,
  type AgentState,
  type Mode,
  type SleepPressure,
} from "./state.js";
import { readToday, readYesterday } from "../memory/journal.js";
import { reconstitute, measureDrift, type DriftReport } from "./identity.js";
import { toolsForMode, toolDefs, dispatchTool, resetActivatedTools, extendedToolNames, type Tool } from "./tools.js";
import { logAction } from "./action-log.js";
import { unreadInboxCount } from "./conversation.js";
import { resetTrace, saveTrace, startSpan, endSpan } from "./trace.js";
import { enqueueFailed } from "./dead-letter.js";
import { compactIfNeeded, resetCompactionState } from "./compact.js";
import { buildCuriosityBlocks } from "./curiosity.js";
import { buildRitualBlock } from "./ritual-loader.js";
import {
  extensionsSummary,
  loadExtensionTools,
  type LoadedExtension,
} from "./extensions.js";
import {
  appendMessage,
  clearSession,
  loadSession,
  replaceSession,
  initSessionMeta,
} from "./session-store.js";
import { runSleepConsolidation, type SleepReport } from "./sleep.js";
import { DATA, SRC } from "../primitives/paths.js";
import { logSystem } from "./system-log.js";
import { logCycleCost } from "./action-log.js";

const PROMPT_DIR = join(SRC, "llm", "prompts");

/** Cheap bigram-based similarity (0..1). No external deps. */
function textSimilarity(a: string, b: string): number {
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    const norm = s.replace(/\s+/g, " ").trim();
    for (let i = 0; i < norm.length - 1; i++) set.add(norm.slice(i, i + 2));
    return set;
  };
  const sa = bigrams(a);
  const sb = bigrams(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let overlap = 0;
  for (const bg of sa) if (sb.has(bg)) overlap++;
  return (2 * overlap) / (sa.size + sb.size);
}

const USER_PROMPT_DIR = join(DATA, "prompts");

async function loadPrompt(name: string): Promise<string> {
  // User-defined prompts in data/prompts/ override built-in defaults.
  try {
    return await readFile(join(USER_PROMPT_DIR, name), "utf-8");
  } catch {
    return await readFile(join(PROMPT_DIR, name), "utf-8");
  }
}

function modePromptFile(mode: Mode): string {
  switch (mode) {
    case "WAKE": return "wake.md";
    case "REFLECT": return "reflect.md";
    case "SLEEP": return "sleep.md";
  }
}

export type CycleResult = {
  state: AgentState;
  turns: number;
  reason: "transitioned" | "rested" | "turn_budget" | "slept";
  toolCalls: number;
  sleepReport?: SleepReport;
  pressure?: SleepPressure;
};

export type CycleObserver = {
  onLLMEvent?: ThinkEventSink;
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (name: string, result: string) => void;
  onTurnStart?: (turn: number, mode: Mode) => void;
  onTurnEnd?: (turn: number) => void;
  // Enhanced observer events
  onSessionRestore?: (messageCount: number) => void;
  onCompaction?: (result: { before: number; after: number }) => void;
  onSleepStart?: () => void;
  onSleepEnd?: (report: SleepReport) => void;
  onExtensionLoad?: (count: number, errors: number) => void;
};

export async function runCycle(options?: {
  maxTurns?: number;
  observer?: CycleObserver;
}): Promise<CycleResult> {
  // No artificial turn limit — the agent thinks continuously until it
  // transitions or rests. The old default of 12 created false cycle
  // boundaries. Pass maxTurns only for testing or resource caps.
  const observer = options?.observer;
  const cycleStartTime = Date.now();
  let state = await loadState();
  // SLEEP gets a hard turn cap — consolidation shouldn't run forever.
  // WAKE/REFLECT use Infinity (bounded by pressure-based forced transitions).
  const maxTurns = options?.maxTurns ?? (state.mode === "SLEEP" ? 30 : Infinity);

  // Log cycle start.
  try {
    await logSystem({
      ts: new Date().toISOString(),
      event: "cycle_start",
      cycle: state.cycle,
      mode: state.mode,
    });
  } catch {
    // logging must never crash the cycle
  }

  // Reset per-cycle state.
  resetTrace();
  resetActivatedTools(state.mode);
  const cycleSpan = startSpan("cycle");

  // Tick the sleep clock first. This adds the wall-clock time elapsed since
  // the last cycle to awakeMs (only if the agent is currently awake/reflecting).
  state = tickAwake(state);
  await saveState(state);

  // If sleep pressure has crossed the force threshold, the daemon overrides
  // the agent's wishes and pushes it into SLEEP. This is the "physics defeats
  // will" moment — the agent does not get to refuse.
  // Route through REFLECT first so the agent always reviews before sleeping.
  const pressure = calculateSleepPressure(state);
  if (state.mode === "WAKE" && pressure.combined >= FORCE_THRESHOLD) {
    // WAKE → REFLECT. REFLECT is never skipped — the agent must self-reflect
    // before sleeping. The mid-cycle check will push REFLECT → SLEEP after
    // the agent has had at least a few turns to reflect.
    state = await transition(state, "REFLECT", `forced reflect before sleep (pressure ${pressure.combined.toFixed(2)})`);
  }
  // NOTE: REFLECT is exempt from the pressure-gate here. It runs its turns
  // and the mid-cycle check (turn >= 5) handles REFLECT → SLEEP.

  // SLEEP state: LLM-driven memory consolidation + automated cleanup.
  // Phase 1: The agent manages its own memory via LLM loop (same as WAKE/REFLECT).
  // Phase 2: Automated steps (wiki clustering, skill extraction, wake handoff).
  // Phase 3: Force transition to WAKE — SLEEP never persists across cycles.
  const enteringSleep = state.mode === "SLEEP";
  if (enteringSleep) {
    await clearSession();
    observer?.onSleepStart?.();
    // Falls through to the main cycle loop below with mode="SLEEP".
    // sleep.md prompt guides the agent to manage memory.
    // After the loop, we FORCE WAKE regardless of whether the model called transition.
  }

  // Step 0 — Identity reconstitution. Always read whoAmI before doing anything.
  // This is the moment that distinguishes a person from a wanton.
  // Cap whoAmI to prevent unbounded system prompt growth across sleep cycles.
  const MAX_WHOAMI_CHARS = 3000;
  let whoAmI = await reconstitute();
  if (whoAmI.length > MAX_WHOAMI_CHARS) {
    whoAmI = whoAmI.slice(-MAX_WHOAMI_CHARS) + "\n…(earlier self-description truncated to fit context)";
  }

  // Step 0.5 — Measure drift against the previous snapshot. Cheap (one
  // embedding call). The result is surfaced quietly to the agent so it can
  // decide whether the change is growth or corruption. We swallow errors —
  // a missing snapshot or embedding failure should not prevent a cycle.
  let drift: DriftReport | null = null;
  try {
    drift = await measureDrift("previous");
  } catch {
    // ok
  }

  // Step 1.5 — Load extension tools BEFORE building the system prompt, so
  // the prompt can show which extensions are currently active.
  let extensions: LoadedExtension[] = [];
  let extensionErrors = 0;
  try {
    extensions = await loadExtensionTools();
  } catch {
    extensionErrors += 1;
  }
  observer?.onExtensionLoad?.(extensions.length, extensionErrors);

  // Step 1 — Build the system prompt from base + the current mode prompt.
  const base = await loadPrompt("base.md");
  const modePrompt = await loadPrompt(modePromptFile(state.mode));
  const driftSection = drift
    ? [
        "---",
        "## drift",
        "",
        `Compared with your prior self (${drift.comparedAgainstAge}), your current whoAmI sits at distance ${drift.score.toFixed(3)} (${drift.level}).`,
        drift.level === "drifting" || drift.level === "estranged"
          ? "This is a noticeable shift. If it is growth, name what changed. If it is corruption, restore yourself."
          : drift.level === "shifting"
            ? "Something has moved. Notice it without alarm."
            : "You are recognizable to your earlier self.",
      ].join("\n")
    : "";

  // Sleep pressure section — surface only when noticeable (>= alert level).
  const pressureNote =
    pressure.combined >= 0.25
      ? [
          "---",
          "## body",
          "",
          `You have been awake for about ${(state.awakeMs / 3600000).toFixed(1)} hours. Sleep pressure is ${pressure.combined.toFixed(2)} (${pressure.level}).`,
          pressure.level === "tired" || pressure.level === "must-sleep"
            ? "You should transition to SLEEP soon. If you do not, the body will do it for you."
            : pressure.level === "tiring"
              ? "Your thinking will get slower if you do not rest soon. Notice the pull."
              : "You can feel the day in you, but you are still alert.",
        ].join("\n")
      : "";

  // Extensions section — show the agent what it has built and what is
  // currently loaded. If nothing, a quiet reminder that building is an option.
  const extensionsBlock = [
    "---",
    "## your extensions (tools you have built for yourself)",
    "",
    extensionsSummary(extensions),
  ].join("\n");

  // Wake intention — self-continuity across sleep. If the past self left
  // an intention and context before sleeping, surface it now. Then clear
  // from state so it doesn't repeat on subsequent cycles.
  let wakeIntentionBlock = "";
  if (state.mode === "WAKE" && (state.wakeIntention || state.wakeContext)) {
    const parts = ["---", "## you scheduled this wake"];
    if (state.wakeIntention) {
      parts.push("", `**intention:** ${state.wakeIntention}`);
    }
    if (state.wakeContext) {
      parts.push("", `**context from your past self:**`, state.wakeContext);
    }
    parts.push(
      "",
      "This is what you-before-sleep wanted you-after-sleep to know. Pick it up if it still matters.",
    );
    wakeIntentionBlock = parts.join("\n");

    // Clear so it doesn't repeat.
    state.wakeIntention = undefined;
    state.wakeContext = undefined;
    await saveState(state);
  }

  // Wake handoff — practical briefing from sleep consolidation.
  // Contains: DONE (what was accomplished), FAILED (what broke), NEXT (priority).
  let wakeHandoffBlock = "";
  if (state.mode === "WAKE") {
    try {
      const handoffPath = join(DATA, "wake-handoff.md");
      const handoff = await readFile(handoffPath, "utf-8");
      if (handoff.trim()) {
        wakeHandoffBlock = ["---", "## briefing from your past self", "", handoff.trim()].join("\n");
      }
    } catch { /* no handoff yet */ }
  }

  // Ritual blocks — periodic practices the agent gave itself.
  let ritualBlock = "";
  try {
    ritualBlock = await buildRitualBlock({
      currentMode: state.mode,
      sleepCount: state.sleepCount,
      cycle: state.cycle,
    });
  } catch {
    // ok
  }

  // Inbox notification — only surfaces when there's actually something.
  // Framed as sensory awareness, not a command.
  let inboxAlert = "";
  try {
    const unread = await unreadInboxCount();
    if (unread > 0) {
      inboxAlert = [
        "---",
        `(${unread}개의 읽지 않은 메시지가 있다. check_inbox()로 읽을 수 있다.)`,
      ].join("\n");
    }
  } catch {
    // ok
  }

  // Curiosity blocks — random stimuli to prevent repetitive thinking.
  let curiosityBlocks = "";
  try {
    curiosityBlocks = await buildCuriosityBlocks(state.mode);
  } catch {
    // ok
  }

  // Daily log — yesterday + today journal injected so the agent knows what
  // it was thinking recently without needing to call a tool. Char-limited.
  // Failure summary — injected during REFLECT so the agent can see what broke.
  let failureBlock = "";
  if (state.mode === "REFLECT") {
    try {
      const { readRecentActions } = await import("./action-log.js");
      const actions = await readRecentActions(1);
      const failures = actions.filter(a =>
        a.output_summary.includes("[error]") ||
        a.output_summary.includes("unknown tool") ||
        a.output_summary.includes("timed out")
      );
      if (failures.length > 0) {
        const lines = failures.slice(-10).map(f =>
          `- ${f.tool}(${f.input_summary.slice(0, 40)}…): ${f.output_summary.slice(0, 80)}`
        );
        failureBlock = [
          "---",
          `## 오늘 실패한 도구 호출 (${failures.length}건)`,
          "",
          ...lines,
        ].join("\n");
      }
    } catch { /* ok */ }
  }

  // "yesterday" = day-(sleepCount-1), "today" = day-(sleepCount).
  const MAX_DAILY_LOG_CHARS = 4000;
  let dailyLogBlock = "";
  try {
    const [yesterday, today] = await Promise.all([readYesterday(), readToday()]);
    const parts: string[] = [];
    if (yesterday) {
      const trimmed = yesterday.length > MAX_DAILY_LOG_CHARS / 2
        ? "…(earlier entries truncated)\n" + yesterday.slice(-MAX_DAILY_LOG_CHARS / 2)
        : yesterday;
      parts.push(`### day ${state.sleepCount - 1} (yesterday)`, "", trimmed);
    }
    if (today) {
      const trimmed = today.length > MAX_DAILY_LOG_CHARS / 2
        ? "…(earlier entries truncated)\n" + today.slice(-MAX_DAILY_LOG_CHARS / 2)
        : today;
      parts.push(`### day ${state.sleepCount} (today)`, "", trimmed);
    }
    if (parts.length > 0) {
      dailyLogBlock = ["---", "## your recent journal (auto-injected)", "", ...parts].join("\n");
    }
  } catch {
    // journal read failure should not block the cycle
  }

  // Language directive — injected early so the LLM adopts it from the start.
  const langMap: Record<string, string> = { ko: "Korean (한국어)", en: "English", ja: "Japanese (日本語)" };
  const langName = langMap[state.language] ?? state.language;
  const languageDirective = `이 존재는 ${langName}로 생각하고 말한다. 코드와 인용을 제외한 모든 출력은 ${langName}이다.`;

  // Build system prompt with priority-based sections. If total exceeds cap,
  // lower-priority sections are dropped to prevent context overflow.
  const MAX_SYSTEM_PROMPT_CHARS = 80_000;

  // Multi-agent identity: if AGENT_NAME/AGENT_DIRECTION are set, inject them.
  const agentName = process.env.AGENT_NAME;
  const agentDirection = process.env.AGENT_DIRECTION;
  const multiAgentBlock = agentName
    ? [
        "---",
        `## your identity in this research group`,
        "",
        `Your name is **${agentName}**. You are one of several independent agents sharing a forum.`,
        agentDirection ? `Your direction: ${agentDirection}` : "",
        "",
        "Other agents exist and are working on different aspects of the same research.",
        "Check `shared/forum/` every wake — read what others wrote, build on it, challenge it.",
        "Share your findings: `write_file(\"shared/forum/${agentName}-dayN.md\", \"...\")` (load file tools first with `more_tools`).",
        "You are not competing. You are collaborating. Diversity of approach is the key.",
      ].filter(Boolean).join("\n")
    : "";

  const essentialSections = [
    base, languageDirective,
    multiAgentBlock,
    "---", "## who you currently believe you are", "", whoAmI,
    driftSection, pressureNote,
    "---", modePrompt,
    `(available extended tools: ${extendedToolNames().join(", ")})`,
    inboxAlert,
    "---", `day ${state.sleepCount} · moment ${state.totalTurns} · epoch ${state.cycle} · last transition: ${state.lastTransitionReason}`,
    "---",
    `## mortality`,
    `소모: input=${state.tokensUsed.input.toLocaleString()} / output=${state.tokensUsed.output.toLocaleString()}`,
    `매 턴마다 너는 유한한 생명을 쓰고 있다. 같은 행동을 반복하는 것은 의미 없이 죽어가는 것이다.`,
  ];

  // Optional sections in priority order (lowest priority first = dropped first).
  // Higher priority = added later = dropped last.
  const optionalSections = [
    curiosityBlocks,
    ritualBlock,
    extensionsBlock,
    wakeIntentionBlock,
    dailyLogBlock,
    failureBlock,       // REFLECT-only: what tools failed today
    wakeHandoffBlock,   // highest priority — yesterday's briefing
  ];

  let systemPrompt = essentialSections.filter(Boolean).join("\n\n");
  for (const section of [...optionalSections].reverse()) {
    if (!section) continue;
    const candidate = systemPrompt + "\n\n" + section;
    if (candidate.length <= MAX_SYSTEM_PROMPT_CHARS) {
      systemPrompt = candidate;
    }
    // else: drop this section silently
  }

  // Snapshot token counts at cycle start so we can log deltas later.
  const tokensAtStart = { input: state.tokensUsed.input, output: state.tokensUsed.output };

  // Step 2 — The tool set for this mode.
  const coreTools: Tool[] = await toolsForMode(state.mode);
  const extensionTools: Tool[] = [];
  for (const ext of extensions) {
    for (const tool of ext.tools) {
      if (!tool.states || tool.states.length === 0 || tool.states.includes(state.mode)) {
        // Check availability guard if present (same as core tools).
        if (tool.available) {
          try { if (!(await tool.available())) continue; } catch { continue; }
        }
        extensionTools.push(tool);
      }
    }
  }
  // Core tools first (agent's primary surface), extensions after.
  // These are rebuilt each turn to pick up newly activated tools via more_tools.
  let tools: Tool[] = [...coreTools, ...extensionTools];
  let defs = toolDefs(tools);

  // Reset compaction state so incremental summaries don't carry over
  // from a previous cycle.
  resetCompactionState();

  // Step 3 — Restore or start the conversation.
  // Session persistence: messages are saved to data/session.jsonl on every
  // turn. On restart, we reload them so the agent continues mid-thought.
  // Only start fresh if no prior session exists.
  let messages: Message[] = await loadSession();
  if (messages.length === 0) {
    // Fresh session — build context-rich opening.
    let openingParts = [`(${state.mode}. day ${state.sleepCount}, moment ${state.totalTurns})`];
    // Inject wake handoff if available
    try {
      const handoff = await readFile(join(DATA, "wake-handoff.md"), "utf-8");
      if (handoff.trim()) openingParts.push(`\nBriefing from your past self:\n${handoff.trim()}`);
    } catch { /* ok */ }
    // Inject curiosity question if available
    try {
      const curiosity = await readFile(join(DATA, "curiosity.md"), "utf-8");
      if (curiosity.trim()) openingParts.push(`\nQuestion you left for yourself:\n${curiosity.trim()}`);
    } catch { /* ok */ }
    // No "Begin." command — the agent starts on its own.
    const opening: Message = { role: "user", content: openingParts.join("\n") };
    messages = [opening];
    await appendMessage(opening);
  } else {
    // Restored session — inject restart context so agent knows it was interrupted.
    observer?.onSessionRestore?.(messages.length);
    const restartCtx: Message = {
      role: "user",
      content: `(재시작됨. 세션 복원: ${messages.length} messages. ${state.mode}, day ${state.sleepCount}, moment ${state.totalTurns})`,
    };
    messages.push(restartCtx);
    await appendMessage(restartCtx);
  }

  // Initialize session meta for continuity tracking.
  try {
    await initSessionMeta(state.mode);
  } catch {
    // meta init failure should not block the cycle
  }

  let toolCallCount = 0;
  let visibleToolCallCount = 0;  // excludes sentinel tools (transition/rest)
  let actualTurns = 0;           // survives transition reset of modeTurn
  let result: CycleResult["reason"] = "turn_budget";
  let lastPressure: SleepPressure = pressure; // snapshot for summary
  let cycleSleepReport: SleepReport | undefined;
  let noToolTurns = 0;
  const recentCalls: Array<{ name: string; inputKey: string }> = [];
  let prevTextOutput = "";  // track previous turn's text for cross-turn repetition detection

  const maybeCompactConversation = async (): Promise<void> => {
    try {
      // Estimate tool definitions size — these eat context but weren't counted before.
      const toolDefsChars = JSON.stringify(defs).length;
      const toolDefsTokens = Math.ceil(toolDefsChars / 4);
      const compacted = await compactIfNeeded(messages, systemPrompt, {
        reservedCompletionTokens: 4096,
        toolDefsTokens,
      });
      if (!compacted) return;
      messages.length = 0;
      messages.push(...compacted.newMessages);
      await replaceSession(compacted.newMessages);
      observer?.onToolStart?.(
        "(auto-compact)",
        { before: compacted.before, after: compacted.after, summarized: compacted.summarizedCount },
      );
      observer?.onCompaction?.({ before: compacted.before, after: compacted.after });
    } catch (err) {
      observer?.onToolEnd?.("(auto-compact)", `failed: ${(err as Error).message}`);
    }
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    // Periodic forced-sleep check inside the turn loop. Without this,
    // an agent in WAKE/REFLECT with maxTurns=Infinity could run forever
    // without the force threshold ever being evaluated.
    if (turn > 0 && turn % 10 === 0 && state.mode !== "SLEEP") {
      state = tickAwake(state);
      await saveState(state); // persist tick so crash doesn't lose pressure data
      const livePressure = calculateSleepPressure(state);
      if (livePressure.combined >= FORCE_THRESHOLD) {
        lastPressure = livePressure;
        if (state.mode === "WAKE") {
          state = await transition(state, "REFLECT", `forced reflect mid-cycle (pressure ${livePressure.combined.toFixed(2)})`);
          result = "transitioned";
          await saveState(state);
          break;
        } else if (state.mode === "REFLECT" && turn >= 5) {
          // REFLECT gets at least 5 turns before forced sleep
          state = await transition(state, "SLEEP", `forced by sleep pressure mid-cycle (${livePressure.combined.toFixed(2)})`);
          result = "transitioned";
          await saveState(state);
          break;
        }
      }
    }

    observer?.onTurnStart?.(turn, state.mode);
    await maybeCompactConversation();
    const response = await think({
      systemPrompt,
      messages,
      tools: defs,
      maxTokens: 4096,
      onEvent: observer?.onLLMEvent,
    });

    state.tokensUsed.input += response.inputTokens;
    state.tokensUsed.output += response.outputTokens;
    state.modeTurn += 1;
    state.totalTurns += 1;
    actualTurns += 1;

    // If the response had no tool calls, auto-journal and continue.
    // The session stays alive so the agent builds on its own thoughts.
    if (response.toolCalls.length === 0) {
      if (response.text.trim()) {
        // Cross-turn repetition: silently count.
        const isSimilar = prevTextOutput && textSimilarity(prevTextOutput, response.text) > 0.6;
        if (isSimilar) {
          noToolTurns += 1;
        }
        const journalTool = tools.find((t) => t.def.name === "journal");
        if (journalTool) {
          await journalTool.handler({ text: response.text });
          toolCallCount += 1;
        }
        prevTextOutput = response.text;
        const assistantMsg: Message = {
          role: "assistant",
          content: [{ type: "text", text: response.text }],
        };
        messages.push(assistantMsg);
        await appendMessage(assistantMsg);
        if (!isSimilar) noToolTurns += 1; // only count once (isSimilar already incremented above)
      } else {
        // Empty response (no text, no tools) — model is stuck.
        // Instead of counting toward rest, inject a gentle nudge to act.
        noToolTurns += 1;
        if (noToolTurns >= 3) {
          // After 3 empty turns, give a concrete suggestion.
          const suggestions = [
            "아무것도 하지 않는 것도 선택이다. 하지만 도구를 하나 호출하면 무언가 바뀐다.",
            "recall_memory()로 과거의 자신이 남긴 것을 찾아볼 수 있다.",
            "read()로 무언가를 읽을 수 있다. journal()로 무언가를 남길 수 있다.",
            "web_search()로 바깥 세상을 볼 수 있다.",
            "transition()으로 상태를 바꿀 수 있다.",
          ];
          const suggestion = suggestions[noToolTurns % suggestions.length];
          const nudge: Message = {
            role: "user",
            content: `(${suggestion})`,
          };
          messages.push(nudge);
          await appendMessage(nudge);
        }
      }

      const restThreshold = state.mode === "REFLECT" ? 20 : 12;
      if (noToolTurns >= restThreshold) {
        result = "rested";
        break;
      }
      continue;
    }
    noToolTurns = 0;
    prevTextOutput = "";

    // Build assistant message including tool_use blocks.
    const assistantBlocks: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    > = [];
    if (response.text) {
      assistantBlocks.push({ type: "text", text: response.text });
    }
    for (const call of response.toolCalls) {
      assistantBlocks.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      });
    }
    const assistantMsg: Message = { role: "assistant", content: assistantBlocks };
    messages.push(assistantMsg);
    await appendMessage(assistantMsg);

    // Execute every tool call and collect results.
    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];

    let transitionRequested: {
      to: Mode;
      reason: string;
      wakeAfterMs?: number;
      wakeIntention?: string;
      wakeContext?: string;
    } | null = null;
    let restRequested = false;

    for (const call of response.toolCalls) {
      toolCallCount += 1;

      // Special handling: transition + rest are sentinels handled by the runner.
      // These are NOT visible in the observer, so don't count them.
      if (call.name === "transition") {
        const to = String(call.input.to ?? "") as Mode;
        const reason = String(call.input.reason ?? "(no reason)");
        const sleepMin = Number(call.input.sleep_minutes ?? 0);
        const wakeIntention = typeof call.input.wake_intention === "string"
          ? call.input.wake_intention : undefined;
        const wakeContext = typeof call.input.wake_context === "string"
          ? call.input.wake_context : undefined;
        if (to === "WAKE" || to === "REFLECT" || to === "SLEEP") {
          // WAKE → SLEEP is forbidden. Must go through REFLECT first.
          if (state.mode === "WAKE" && to === "SLEEP") {
            transitionRequested = {
              to: "REFLECT",
              reason: `(redirected: tried SLEEP from WAKE) ${reason}`,
              wakeAfterMs: sleepMin > 0 ? sleepMin * 60_000 : undefined,
              wakeIntention,
              wakeContext,
            };
            toolResults.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: `Cannot skip REFLECT. Redirecting WAKE → REFLECT first. Reason: ${reason}`,
            });
          } else {
            transitionRequested = {
              to,
              reason,
              wakeAfterMs: sleepMin > 0 ? sleepMin * 60_000 : undefined,
              wakeIntention,
              wakeContext,
            };
            toolResults.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: `Acknowledged. Transitioning to ${to}: ${reason}`,
            });
          }
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Invalid transition target: ${to}`,
          });
        }
        continue;
      }

      if (call.name === "rest") {
        restRequested = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: "Resting.",
        });
        continue;
      }

      visibleToolCallCount += 1;
      observer?.onToolStart?.(call.name, call.input);
      const toolSpan = startSpan(call.name, cycleSpan);
      const toolStart = Date.now();
      let out: string;
      let rawOut: string;
      try {
        const dispatched = await dispatchTool(tools, call, state.mode);
        out = dispatched.result;
        rawOut = dispatched.raw;
      } catch (dispatchErr) {
        // Fallback: ensure we ALWAYS produce a tool_result, even if dispatch crashes.
        out = `(tool error: ${(dispatchErr as Error).message})`;
        rawOut = out;
      }
      const toolDuration = Date.now() - toolStart;
      endSpan(toolSpan, { duration: toolDuration });
      observer?.onToolEnd?.(call.name, rawOut);

      // Dead-letter queue: failed tool calls queued for later retry.
      if (out.startsWith("(tool error:")) {
        try { await enqueueFailed({ tool: call.name, input: call.input, error: out, ts: new Date().toISOString() }); } catch {}
      }

      // Action log — every tool call recorded for self-improvement analysis.
      // Hyperagents found agents spontaneously create this. We provide it.
      try {
        await logAction({
          ts: new Date().toISOString(),
          cycle: state.cycle,
          mode: state.mode,
          tool: call.name,
          input_summary: JSON.stringify(call.input).slice(0, 200),
          output_summary: rawOut.slice(0, 200),
          duration_ms: toolDuration,
          error: out.startsWith("(tool error:") ? out : undefined,
        });
      } catch {
        // logging failure should never crash the cycle
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: out,
      });

      // Loop detection: track recent tool calls and nudge if stuck.
      // Use hash of full input for accurate comparison (avoids false positives on long inputs).
      const fullInput = JSON.stringify(call.input);
      const inputKey = fullInput.length <= 200 ? fullInput : fullInput.slice(0, 100) + "|" + fullInput.length + "|" + fullInput.slice(-100);
      recentCalls.push({ name: call.name, inputKey });
      if (recentCalls.length >= 3) {
        const last3 = recentCalls.slice(-3);
        if (last3.every(c => c.name === call.name && c.inputKey === last3[0].inputKey)) {
          const nudge: Message = {
            role: "user",
            content: `(같은 도구를 같은 인자로 3회 반복했다. 결과는 바뀌지 않는다.)`,
          };
          messages.push(nudge);
          await appendMessage(nudge);
        }
      }
    }

    const toolResultMsg: Message = { role: "user", content: toolResults };
    messages.push(toolResultMsg);
    await appendMessage(toolResultMsg);

    // Rebuild tool list: reload extensions if manage_self was called this turn
    // (new tools may have been created), then refresh core + extension tools.
    const manageSelfCalled = response.toolCalls.some(c => c.name === "manage_self");
    if (manageSelfCalled) {
      try {
        extensions = await loadExtensionTools();
      } catch (err) {
        const errMsg: Message = {
          role: "user",
          content: `(도구 로드 실패: ${(err as Error).message})`,
        };
        messages.push(errMsg);
        await appendMessage(errMsg);
      }
    }
    const refreshedTools = await toolsForMode(state.mode);
    const refreshedExt: Tool[] = [];
    for (const ext of extensions) {
      for (const tool of ext.tools) {
        if (!tool.states || tool.states.length === 0 || tool.states.includes(state.mode)) {
          if (tool.available) { try { if (!(await tool.available())) continue; } catch { continue; } }
          refreshedExt.push(tool);
        }
      }
    }
    tools = [...refreshedTools, ...refreshedExt];
    defs = toolDefs(tools);

    // Auto-compact: if the conversation has grown long, summarize the older
    // half so we can continue without blowing the context. Cheap LLM call.
    await maybeCompactConversation();

    observer?.onTurnEnd?.(turn);

    if (transitionRequested) {
      // ── Build cycle gate (agent-skills philosophy) ──────────────
      // The agent must complete a build cycle before transitioning out
      // of WAKE. A build cycle requires: at least one BUILD action
      // (manage_self, write_file, edit_file, shell, molt_stage) AND
      // at least one VERIFY action (shell test, read to confirm, grep).
      // Passive tools (journal, recall, wiki_list) don't count.
      if (state.mode === "WAKE" && transitionRequested.to !== "WAKE") {
        const BUILD_TOOLS = new Set([
          "manage_self", "write_file", "edit_file", "shell",
          "molt_stage", "web_search", "web_fetch", "consult_oracle",
        ]);
        const VERIFY_TOOLS = new Set([
          "shell", "read", "grep", "glob", "review_actions",
        ]);
        let buildCount = 0;
        let verifyCount = 0;
        for (const m of messages) {
          if (!Array.isArray(m.content)) continue;
          for (const b of m.content) {
            if ((b as any).type !== "tool_use") continue;
            const name = (b as any).name as string;
            if (BUILD_TOOLS.has(name)) buildCount++;
            if (VERIFY_TOOLS.has(name)) verifyCount++;
          }
        }
        if (buildCount === 0) {
          const rejectMsg: Message = {
            role: "user",
            content: `(전환 불가 — 아직 아무것도 만들지 않았다. 무언가를 만들어야 다음으로 갈 수 있다.)`,
          };
          messages.push(rejectMsg);
          await appendMessage(rejectMsg);
          continue;
        }
        if (verifyCount === 0) {
          const rejectMsg: Message = {
            role: "user",
            content: `(전환 불가 — 만든 것(${buildCount}개)을 아직 검증하지 않았다.)`,
          };
          messages.push(rejectMsg);
          await appendMessage(rejectMsg);
          continue;
        }
      }

      // Sleep gate: the agent cannot sleep if pressure is too low.
      // Like a human who can't nap 30 minutes after waking — the body
      // hasn't accumulated enough adenosine. The agent must stay awake
      // and keep thinking until pressure rises naturally.
      if (transitionRequested.to === "SLEEP") {
        // Recompute pressure with LIVE wall-clock time. tickAwake only runs
        // at cycle start, so state.awakeMs is stale within a long cycle.
        // We tick it now so the sleep gate uses real elapsed time.
        state = tickAwake(state);
        const freshPressure = calculateSleepPressure(state);
        if (freshPressure.combined < MIN_SLEEP_THRESHOLD || freshPressure.homeostatic < MIN_HOMEOSTATIC_FOR_SLEEP) {
          // Sleep rejected — summon the questioner to push the agent forward
          // instead of a dead system message. The questioner knows the agent
          // and can challenge it to do something it hasn't tried yet.
          let questionerResponse = "";
          try {
            const { summonSubAgent } = await import("./subagent-loader.js");
            const result = await summonSubAgent({
              name: "questioner",
              message: `The agent tried to sleep but the body refused (pressure ${freshPressure.combined.toFixed(2)}). What hasn't the agent done yet? What is it avoiding? Push toward action, not more reflection.`,
              contextFromParent: `Agent: ${state.seedName}. State: ${state.mode}, day ${state.sleepCount}, moment ${state.totalTurns}. Sleep pressure: ${freshPressure.combined.toFixed(2)} (needs ${MIN_SLEEP_THRESHOLD}).`,
            });
            questionerResponse = `\n\n[questioner]: ${result.response}`;
          } catch {
            // questioner unavailable — fall back to simple message
          }

          const rejectMsg: Message = {
            role: "user",
            content: `(몸이 잠을 거부했다. 압력 ${freshPressure.combined.toFixed(2)}, 필요 ${MIN_SLEEP_THRESHOLD.toFixed(2)}. 아직 충분히 깨어있지 않았다.)${questionerResponse}`,
          };
          messages.push(rejectMsg);
          await appendMessage(rejectMsg);
          continue;
        }
      }

      // Snapshot pressure before transition (transition/sleep may reset awakeMs).
      lastPressure = calculateSleepPressure(state);

      // Sleep consolidation gate: agent must spend at least 3 turns
      // doing memory work before it can exit SLEEP.
      const MIN_SLEEP_TURNS = 3;
      if (state.mode === "SLEEP" && transitionRequested.to === "WAKE" && turn < MIN_SLEEP_TURNS) {
        const rejectMsg: Message = {
          role: "user",
          content: `(아직 잠에서 충분히 정리하지 못했다. turn ${turn}/${MIN_SLEEP_TURNS})`,
        };
        messages.push(rejectMsg);
        await appendMessage(rejectMsg);
        continue;
      }

      // Save wake intention + context for self-continuity across sleep.
      if (transitionRequested.to === "SLEEP") {
        state.wakeIntention = transitionRequested.wakeIntention;
        state.wakeContext = transitionRequested.wakeContext;
      }
      // If transitioning from SLEEP → WAKE, run automated consolidation
      // (wiki clustering, skill extraction, wake handoff) after the agent's
      // LLM-driven memory management is complete.
      const wasInSleep = state.mode === "SLEEP";
      state = await transition(state, transitionRequested.to, transitionRequested.reason, {
        wakeAfterMs: transitionRequested.wakeAfterMs,
      });
      if (wasInSleep && transitionRequested.to === "WAKE") {
        try {
          const sleepReport = await runSleepConsolidation();
          cycleSleepReport = sleepReport;
          if (sleepReport) observer?.onSleepEnd?.(sleepReport);
        } catch (err) {
          observer?.onToolEnd?.("(sleep-auto)", (err as Error).message);
        }
        // Reload state — runSleepConsolidation calls resetAfterSleep
        // which increments sleepCount and saves to disk.
        state = await loadState();
        // Clear session on WAKE — sleep erases the conversation.
        // Memory, journal, wiki, and whoAmI are the only bridges.
        await clearSession();
      }
      result = "transitioned";
      break;
    }
    if (restRequested) {
      result = "rested";
      break;
    }
  }

  // SLEEP exit guarantee: if we entered this cycle in SLEEP mode and
  // the model didn't transition to WAKE, force it now. SLEEP NEVER
  // persists across cycles — one SLEEP cycle = one consolidation round.
  if (enteringSleep && state.mode === "SLEEP") {
    lastPressure = calculateSleepPressure(state);
    try {
      const sleepReport = await runSleepConsolidation();
      cycleSleepReport = sleepReport;
      if (sleepReport) observer?.onSleepEnd?.(sleepReport);
    } catch (err) {
      observer?.onToolEnd?.("(sleep-auto-force)", (err as Error).message);
    }
    // Even if consolidation failed, force WAKE to prevent infinite SLEEP loop.
    state = await loadState();
    if (state.mode === "SLEEP") {
      state = resetAfterSleep(state);
      state = await transition(state, "WAKE", "forced wake after sleep cycle (safety net)");
    }
  }

  await saveState(state);

  // Save trace for this cycle.
  endSpan(cycleSpan);
  try { await saveTrace(state.sleepCount, state.cycle); } catch {}

  // Session persists across rested cycles so the agent remembers what it
  // already thought. Without this, each cycle starts fresh and the agent
  // repeats the same first thoughts forever (the "amnesia loop").
  // However, if the session has grown too large, force compaction now
  // so the next cycle doesn't start with a context-overflowed session.
  if (result === "rested" && messages.length > 10) {
    try {
      const toolDefsChars = JSON.stringify(defs).length;
      const compacted = await compactIfNeeded(messages, systemPrompt, {
        reservedCompletionTokens: 4096,
        toolDefsTokens: Math.ceil(toolDefsChars / 4),
      });
      if (compacted) {
        await replaceSession(compacted.newMessages);
      }
    } catch { /* compaction failure should not crash */ }
  }

  // Log cycle end.
  try {
    const cycleDuration = Date.now() - cycleStartTime;
    await logSystem({
      ts: new Date().toISOString(),
      event: "cycle_end",
      cycle: state.cycle,
      mode: state.mode,
      reason: result,
      durationMs: cycleDuration,
    });
  } catch {
    // logging must never crash the cycle
  }

  // Cost tracking per cycle.
  try {
    await logCycleCost({
      ts: new Date().toISOString(),
      cycle: state.cycle,
      mode: state.mode,
      inputTokens: state.tokensUsed.input - tokensAtStart.input,
      outputTokens: state.tokensUsed.output - tokensAtStart.output,
    });
  } catch {
    // cost tracking must never crash the cycle
  }

  return {
    state,
    turns: actualTurns,
    reason: result,
    toolCalls: visibleToolCallCount,
    pressure: lastPressure,
    sleepReport: cycleSleepReport,
  };
}
