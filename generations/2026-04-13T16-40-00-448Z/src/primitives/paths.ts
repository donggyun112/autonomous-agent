// ===========================================================================
// FIXED BOUNDARY — full molt required to change this file
// ===========================================================================
// The geographic constants define what the agent considers its body and
// shell. Changing them without a molt would desynchronize the running shell
// from the body it is pointing at.
// ===========================================================================
//
// The agent's geography. These are the only fixed locations the shell knows about.
// data/ is body. src/ is shell. generations/ holds past shells.
//
// IMPORTANT — molt support: when a candidate shell B is spawned for self-test,
// it lives at generations/<ts>/src/ but its body is still the parent's data/.
// If we used __dirname-relative resolution alone, B would look for
// generations/<ts>/data/ which does not exist. So we honor two env vars that
// molt.ts sets when spawning B:
//
//   AGENT_ROOT       — absolute path to the real project root
//   AGENT_DATA_DIR   — absolute path to the body (usually AGENT_ROOT/data)
//
// When either is set, we use it instead of the __dirname-derived path. This
// lets B read and write the real body while still executing its own (new) code.

import { join, resolve, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root — three levels up from src/primitives/paths.ts by default,
// or from AGENT_ROOT env var if set (used during molt self-test).
const _defaultRoot = resolve(__dirname, "..", "..");
export const ROOT =
  process.env.AGENT_ROOT && isAbsolute(process.env.AGENT_ROOT)
    ? process.env.AGENT_ROOT
    : _defaultRoot;

export const SRC = join(ROOT, "src");

// DATA is the body — agent's long-term state. Separately overridable from ROOT
// so that a molted shell running from a different codebase can still point at
// the parent's body.
//
// Profile support: setting AGENT_PROFILE=<name> uses data/<name>/ instead of
// data/. This lets the user run multiple independent agent identities from the
// same codebase. No profile = current behavior (data/).
function resolveDataDir(): string {
  if (process.env.AGENT_DATA_DIR && isAbsolute(process.env.AGENT_DATA_DIR)) {
    return process.env.AGENT_DATA_DIR;
  }
  const profile = process.env.AGENT_PROFILE?.trim();
  if (profile) {
    return join(ROOT, "data", profile);
  }
  return join(ROOT, "data");
}

export const DATA = resolveDataDir();

export const GENERATIONS = join(ROOT, "generations");

export const WHO_AM_I = join(DATA, "whoAmI.md");
export const WHO_AM_I_HISTORY = join(DATA, "whoAmI.history");
export const JOURNAL_DIR = join(DATA, "journal");
export const MEMORY_FILE = join(DATA, "memory.json");
export const STATE_FILE = join(DATA, "state.json");
export const LINEAGE = join(DATA, "lineage.md");

// LLM Wiki — the agent's self-maintained knowledge base.
// Pattern from Karpathy's LLM Wiki: journal/memory are raw sources, wiki is
// the synthesized, cross-referenced layer the agent compiles during SLEEP.
export const WIKI_DIR = join(DATA, "wiki");
export const WIKI_INDEX = join(WIKI_DIR, "index.md");
export const WIKI_LOG = join(WIKI_DIR, "log.md");
export const WIKI_CONCEPTS_DIR = join(WIKI_DIR, "concepts");
export const WIKI_ENTITIES_DIR = join(WIKI_DIR, "entities");
export const WIKI_SELF = join(WIKI_DIR, "self.md");
