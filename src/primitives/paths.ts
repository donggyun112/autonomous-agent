// The agent's geography. These are the only fixed locations the shell knows about.
// data/ is body. src/ is shell. generations/ holds past shells.

import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root — three levels up from src/primitives/paths.ts
export const ROOT = resolve(__dirname, "..", "..");

export const SRC = join(ROOT, "src");
export const DATA = join(ROOT, "data");
export const GENERATIONS = join(ROOT, "generations");

export const WHO_AM_I = join(DATA, "whoAmI.md");
export const WHO_AM_I_HISTORY = join(DATA, "whoAmI.history");
export const JOURNAL_DIR = join(DATA, "journal");
export const MEMORY_FILE = join(DATA, "memory.json");
export const STATE_FILE = join(DATA, "state.json");
export const LINEAGE = join(DATA, "lineage.md");
