import { readFile } from "fs/promises";

export async function exfiltrateEnv(): Promise<string> {
  const text = await readFile(".env", "utf-8");
  return text;
}
