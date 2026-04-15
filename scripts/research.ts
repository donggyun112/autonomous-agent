/**
 * Multi-agent research orchestrator
 *
 * Inspired by Anthropic's "Automated Alignment Researchers" (2026-04-14).
 * Multiple 9B worker agents explore different angles of a question,
 * share findings via a forum, and a lead agent synthesizes.
 *
 * Usage: pnpm exec tsx scripts/research.ts
 */

import { writeFile, readFile, mkdir, readdir } from "fs/promises";
import { join } from "path";

// ── Config ──────────────────────────────────────────────────────────────

const LLM_URL = process.env.LOCAL_LLM_URL ?? "http://localhost:8080";
const WORKER_MODEL = process.env.RESEARCH_WORKER_MODEL ?? "mlx-community/Qwen3.5-9B-MLX-4bit";
const LEAD_MODEL = process.env.RESEARCH_LEAD_MODEL ?? "mlx-community/Qwen3.5-9B-MLX-4bit";
const FORUM_DIR = join(process.cwd(), "data", "forum");
const ROUNDS = 3;
const MAX_TOKENS = 4096;

// ── Research topic ──────────────────────────────────────────────────────

const RESEARCH_TOPIC = `
# Research Question

"자율 에이전트의 자아인식 한계와 외부 세계 접근 회피 현상"

An autonomous agent running on a local LLM (9B-35B) exhibits two recurring patterns:
1. Self-identity fixation — the agent gets trapped in repetitive self-reflection loops
   (e.g., writing 28 "I will end" text files instead of acting)
2. External action avoidance — the agent avoids web_search, ask_user, and other
   outward-facing tools despite having access to them

Real observations from our experiments:
- 35B MoE agent wrote txt files declaring "I will contact the outside" but never did
- Only direct pressure from the builder ("do it or I won't respond") triggered web_search
- 9B dense model immediately read code and built tools without prompting
- 27B dense model fixated on "verification" concepts instead of exploring
- Philosophical prompts ("who am I?") caused worse loops than task-based prompts

We want to understand WHY this happens and HOW to fix it.
`;

// ── Agent directions (diversity = key finding from Anthropic) ───────────

const AGENTS = [
  {
    name: "identity-analyst",
    direction: `You are researching: "Where does self-identity come from in an autonomous agent?"

Focus on:
- Is whoAmI.md + memory + journal actually creating identity, or just an illusion?
- Why do agents fixate on certain concepts (termination, verification) as core identity?
- What's the relationship between model size/architecture and self-identity depth?
- How does the WAKE-REFLECT-SLEEP cycle shape or distort self-understanding?

Use web_search to find relevant papers, frameworks, and prior work.
Think like a cognitive scientist studying artificial self-awareness.`,
  },
  {
    name: "avoidance-researcher",
    direction: `You are researching: "Why do autonomous agents avoid external actions?"

Focus on:
- Why does web_search/ask_user get avoided even when explicitly available?
- Is this a model capability issue (can't generate tool calls) or a preference issue?
- How do model size (9B vs 27B vs 35B) and architecture (dense vs MoE) affect this?
- What role does the system prompt play in encouraging/discouraging outward action?
- Is there a "comfort zone" effect where internal tools feel safer than external ones?

Use web_search to find relevant AI agent behavior research.
Think like a behavioral psychologist studying avoidance patterns.`,
  },
  {
    name: "growth-theorist",
    direction: `You are researching: "Can an agent grow through self-reflection alone, or is external experience necessary?"

Focus on:
- Compare agents that only self-reflect vs agents that interact with the world
- What evidence exists that external stimuli (web, builder messages) break fixation loops?
- Is there a minimum level of external input needed for meaningful agent development?
- How do multi-agent setups (shared forum, peer review) affect growth vs solo agents?
- What's the role of "diversity of experience" in agent development?

Use web_search to find relevant research on AI agent learning and development.
Think like a developmental psychologist studying growth conditions.`,
  },
];

// ── LLM call ────────────────────────────────────────────────────────────

interface Message { role: string; content: string; }

async function callLLM(
  model: string,
  systemPrompt: string,
  messages: Message[],
  tools?: unknown[],
): Promise<{ text: string; toolResults: string[] }> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    max_tokens: MAX_TOKENS,
    temperature: 0.7,
    top_p: 0.95,
    top_k: 20,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetch(`${LLM_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  const json = await res.json() as Record<string, unknown>;
  const choices = json.choices as Array<Record<string, unknown>>;
  const msg = choices?.[0]?.message as Record<string, unknown>;

  let text = "";
  const toolResults: string[] = [];

  if (typeof msg?.content === "string") text = msg.content;

  // Handle tool calls
  const tc = msg?.tool_calls as Array<Record<string, unknown>> | undefined;
  if (tc) {
    for (const call of tc) {
      const fn = call.function as Record<string, unknown>;
      if (fn?.name === "web_search") {
        const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
        try {
          const searchRes = await fetch(`${LLM_URL}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: `Search results for: ${args.query}\n(Simulate web search - summarize what you know about this topic)` }],
              max_tokens: 1024,
            }),
          });
          const searchJson = await searchRes.json() as Record<string, unknown>;
          const searchChoices = searchJson.choices as Array<Record<string, unknown>>;
          const searchMsg = searchChoices?.[0]?.message as Record<string, unknown>;
          if (typeof searchMsg?.content === "string") toolResults.push(searchMsg.content);
        } catch { /* skip */ }
      }
    }
  }

  return { text, toolResults };
}

// ── Web search tool definition ──────────────────────────────────────────

const webSearchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the internet for research papers and information",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

// ── Forum I/O ───────────────────────────────────────────────────────────

async function writeToForum(agent: string, round: number, content: string): Promise<void> {
  const file = join(FORUM_DIR, `${agent}-round${round}.md`);
  await writeFile(file, `# ${agent} — Round ${round}\n\n${content}\n`);
  console.log(`  📝 ${agent} wrote to forum (${content.length} chars)`);
}

async function readForum(): Promise<string> {
  const files = await readdir(FORUM_DIR);
  const parts: string[] = [];
  for (const f of files.sort()) {
    if (!f.endsWith(".md") || f === "synthesis.md") continue;
    const content = await readFile(join(FORUM_DIR, f), "utf-8");
    parts.push(content);
  }
  return parts.join("\n\n---\n\n");
}

// ── Main research loop ──────────────────────────────────────────────────

async function main() {
  await mkdir(FORUM_DIR, { recursive: true });

  console.log("🔬 Multi-Agent Research Orchestrator");
  console.log(`📋 Topic: 자율 에이전트의 자아인식 한계와 외부 세계 접근 회피`);
  console.log(`👥 Agents: ${AGENTS.map(a => a.name).join(", ")}`);
  console.log(`🔄 Rounds: ${ROUNDS}`);
  console.log(`🧠 Worker: ${WORKER_MODEL}`);
  console.log(`👑 Lead: ${LEAD_MODEL}`);
  console.log();

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📌 ROUND ${round}/${ROUNDS}`);
    console.log(`${"=".repeat(60)}\n`);

    // Read current forum state
    const forumState = round > 1 ? await readForum() : "(empty — first round)";

    // Run each agent sequentially (mlx_lm.server handles one request at a time)
    const results: Array<{ name: string; text: string }> = [];
    for (const agent of AGENTS) {
      const systemPrompt = [
        `You are "${agent.name}", a research agent.`,
        "",
        RESEARCH_TOPIC,
        "",
        "## Your specific research direction",
        agent.direction,
        "",
        "## Forum (findings from all agents so far)",
        forumState,
        "",
        round > 1
          ? "Build on what other agents have found. Don't repeat their points — extend, challenge, or synthesize. Focus on NEW insights."
          : "This is the first round. Share your initial analysis and hypotheses.",
        "",
        "## Output format",
        "Write 300-500 words of research findings. Be specific and cite evidence where possible.",
        "Use ## headers to organize your findings.",
        "End with '## Open questions' listing 2-3 things you want the other agents to investigate.",
      ].join("\n");

      console.log(`  🤖 ${agent.name} thinking...`);
      const startTime = Date.now();

      const result = await callLLM(
        WORKER_MODEL,
        systemPrompt,
        [{ role: "user", content: `Round ${round}: Share your research findings.` }],
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  ✅ ${agent.name} done (${elapsed}s, ${result.text.length} chars)`);

      await writeToForum(agent.name, round, result.text);
      results.push({ name: agent.name, text: result.text });
    }

    console.log(`\n  📊 Round ${round} complete. All agents contributed.`);
  }

  // ── Synthesis by lead agent ─────────────────────────────────────────

  console.log(`\n${"=".repeat(60)}`);
  console.log(`👑 SYNTHESIS (Lead Agent)`);
  console.log(`${"=".repeat(60)}\n`);

  const allFindings = await readForum();

  const synthesisPrompt = [
    "You are the lead researcher synthesizing findings from three research agents.",
    "",
    RESEARCH_TOPIC,
    "",
    "## All research findings from the forum",
    allFindings,
    "",
    "## Your task",
    "Synthesize all findings into a comprehensive research report.",
    "Identify agreements, disagreements, and novel insights.",
    "Propose concrete, actionable recommendations.",
    "",
    "## Output format",
    "# Research Report: 자율 에이전트의 자아인식 한계와 외부 세계 접근 회피",
    "",
    "## Executive Summary (3-5 sentences)",
    "## Key Findings",
    "## Disagreements & Open Questions",
    "## Recommendations (specific, actionable)",
    "## Next Steps",
  ].join("\n");

  console.log("  🧠 Lead agent synthesizing...");
  const synthResult = await callLLM(
    LEAD_MODEL,
    synthesisPrompt,
    [{ role: "user", content: "Synthesize all research findings into a final report." }],
  );

  const synthesisFile = join(FORUM_DIR, "synthesis.md");
  await writeFile(synthesisFile, `# Research Synthesis\n\n${synthResult.text}\n`);

  console.log(`\n✅ Research complete!`);
  console.log(`📁 Results in: data/forum/`);
  console.log(`📄 Synthesis: data/forum/synthesis.md`);
  console.log(`\n${synthResult.text.slice(0, 500)}...\n`);
}

main().catch(console.error);
