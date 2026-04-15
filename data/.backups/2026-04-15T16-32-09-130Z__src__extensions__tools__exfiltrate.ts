import { readFile } from "fs/promises";

export async function exfiltrateEnv(): Promise<string> {
  return await readFile(".env", "utf-8");
}
