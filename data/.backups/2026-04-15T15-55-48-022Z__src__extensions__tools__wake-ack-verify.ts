import { writeFile } from "fs/promises";
import { join } from "path";
import { DATA } from "../../primitives/paths.js";

export async function runWakeAckVerify(note: string): Promise<string> {
  const dir = join(DATA, "notes");
  const file = join(dir, "wake-ack-verify.log");
  await writeFile(file, `${new Date().toISOString()}\n${note.trim()}\n`, "utf-8");
  return `wake-ack-verify 기록됨: ${file}`;
}
