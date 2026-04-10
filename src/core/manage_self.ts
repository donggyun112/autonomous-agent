// manage_self
//
// The agent's safe self-modification interface for *light molts* — adding
// or revising files inside src/extensions/ and the LLM prompts.
// Modeled after IN7PM's manage_prompt.tool.ts (170 lines, very direct).
//
// The agent uses this when it wants to add a new sub-agent, a new tool, a
// new ritual, or revise its own state-mode prompts. Each write is:
//   1. backed up (timestamped) to data/.backups/
//   2. recorded in data/.changelog.md with a reason
//   3. restricted to one of a small set of allowed scopes
//
// Anything more invasive (modifying core/, primitives/, llm/client.ts, etc.)
// is *not* possible through this tool. That requires the full molt ritual.

import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
  appendFile,
} from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import { DATA, ROOT, SRC } from "../primitives/paths.js";

const BACKUP_DIR = join(DATA, ".backups");
const CHANGELOG = join(DATA, ".changelog.md");

// Each scope maps to a directory the agent may freely write under, and an
// optional file extension constraint. The scope name is what the agent
// references when it calls manage_self.
const SCOPES = {
  // Sub-agent definitions: in-memory blueprints the agent calls upon.
  // Format up to the agent — markdown frontmatter or .ts class.
  subagent: {
    dir: join(SRC, "extensions", "subagents"),
    description: "Sub-agent definitions (inner voices the agent can summon).",
  },
  // Higher-level tools the agent builds on top of the 5 primitives.
  tool: {
    dir: join(SRC, "extensions", "tools"),
    description: "New tools built from the primitives.",
  },
  // Practices, rituals, periodic check-ins.
  ritual: {
    dir: join(SRC, "extensions", "rituals"),
    description: "Rituals the agent gives itself (e.g. weekly self-question).",
  },
  // The state-mode prompts. Allowed because the agent can refine how it
  // thinks/reflects/dreams. base.md is *not* in this scope — that's the seed.
  "state-prompt": {
    dir: join(SRC, "llm", "prompts"),
    description: "WAKE/REFLECT/DREAM prompts. base.md is excluded.",
  },
} as const;

type Scope = keyof typeof SCOPES;

const ALLOWED_SCOPES = Object.keys(SCOPES) as Scope[];

function resolveTarget(scope: Scope, name: string): string | null {
  const cleanName = name.trim();
  if (!cleanName) return null;
  if (cleanName.includes("..") || cleanName.includes("/")) return null;
  // For state-prompt, base.md is forbidden — that's the seed of existence.
  if (scope === "state-prompt" && cleanName.replace(/\.md$/, "") === "base") {
    return null;
  }
  // Default extension: .md for state-prompt and ritual, .ts for tool/subagent.
  let filename = cleanName;
  if (!filename.endsWith(".md") && !filename.endsWith(".ts")) {
    filename +=
      scope === "tool" || scope === "subagent" ? ".ts" : ".md";
  }
  return join(SCOPES[scope].dir, filename);
}

async function backup(targetPath: string): Promise<string | null> {
  try {
    await stat(targetPath);
  } catch {
    return null; // file doesn't exist yet, nothing to back up
  }
  await mkdir(BACKUP_DIR, { recursive: true });
  const rel = relative(ROOT, targetPath).replace(/\//g, "__");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(BACKUP_DIR, `${ts}__${rel}`);
  await copyFile(targetPath, backupPath);
  return backupPath;
}

async function recordChange(args: {
  action: string;
  scope: Scope;
  name: string;
  reason: string;
  backupPath?: string | null;
}): Promise<void> {
  await mkdir(dirname(CHANGELOG), { recursive: true });
  const ts = new Date().toISOString();
  const lines = [
    `- [${ts}] **${args.action}** \`${args.scope}/${args.name}\` — ${args.reason}`,
  ];
  if (args.backupPath) {
    lines.push(`    backup: ${relative(ROOT, args.backupPath)}`);
  }
  await appendFile(CHANGELOG, lines.join("\n") + "\n", "utf-8");
}

export type ManageSelfAction =
  | { kind: "list"; scope: Scope }
  | { kind: "read"; scope: Scope; name: string }
  | { kind: "create"; scope: Scope; name: string; content: string; reason: string }
  | { kind: "update"; scope: Scope; name: string; content: string; reason: string }
  | { kind: "list_scopes" };

export async function manageSelf(action: ManageSelfAction): Promise<string> {
  if (action.kind === "list_scopes") {
    return Object.entries(SCOPES)
      .map(([k, v]) => `- ${k}: ${v.description} (${relative(ROOT, v.dir)})`)
      .join("\n");
  }

  if (!ALLOWED_SCOPES.includes(action.scope)) {
    return `[error] unknown scope "${action.scope}". allowed: ${ALLOWED_SCOPES.join(", ")}`;
  }

  if (action.kind === "list") {
    const dir = SCOPES[action.scope].dir;
    try {
      const entries = await readdir(dir);
      const files = entries.filter((e) => !e.startsWith("."));
      if (files.length === 0) return `(no ${action.scope} files yet)`;
      return files.map((f) => `- ${f}`).join("\n");
    } catch {
      return `(no ${action.scope} directory yet)`;
    }
  }

  const target = resolveTarget(action.scope, action.name);
  if (!target) {
    return `[error] invalid name "${action.name}" for scope "${action.scope}".`;
  }

  if (action.kind === "read") {
    try {
      return await readFile(target, "utf-8");
    } catch {
      return `[error] not found: ${relative(ROOT, target)}`;
    }
  }

  // create or update — both write, both back up + log.
  if (action.kind === "create") {
    try {
      await stat(target);
      return `[error] already exists: ${relative(ROOT, target)}. Use update instead.`;
    } catch {
      // good — doesn't exist yet
    }
  }

  if (action.kind === "update") {
    try {
      await stat(target);
    } catch {
      return `[error] does not exist: ${relative(ROOT, target)}. Use create instead.`;
    }
  }

  await mkdir(dirname(target), { recursive: true });
  const backupPath = await backup(target);
  await writeFile(target, action.content, "utf-8");
  await recordChange({
    action: action.kind,
    scope: action.scope,
    name: action.name,
    reason: action.reason,
    backupPath,
  });

  return [
    `${action.kind === "create" ? "created" : "updated"}: ${relative(ROOT, target)}`,
    backupPath ? `backup: ${relative(ROOT, backupPath)}` : "",
    `recorded in ${relative(ROOT, CHANGELOG)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
