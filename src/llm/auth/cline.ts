import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

type ClineAuth = {
  accessToken?: string;
  expiresAt?: number;
};

function providersPath(): string {
  return process.env.CLINE_PROVIDERS_PATH ??
    join(homedir(), ".cline", "data", "settings", "providers.json");
}

function expirySeconds(expiresAt: number): number {
  return expiresAt > 10_000_000_000 ? expiresAt / 1000 : expiresAt;
}

async function loadAuthFromProvidersFile(): Promise<ClineAuth> {
  const text = await readFile(providersPath(), "utf-8");
  const data = JSON.parse(text) as {
    providers?: {
      cline?: {
        settings?: {
          auth?: ClineAuth;
        };
      };
    };
  };
  return data.providers?.cline?.settings?.auth ?? {};
}

export async function loadClineAccessToken(): Promise<string> {
  const envToken = process.env.CLINE_ACCESS_TOKEN?.trim();
  if (envToken) return envToken;

  const auth = await loadAuthFromProvidersFile();
  const token = auth.accessToken?.trim();
  if (!token) {
    throw new Error(`No Cline auth. Run Cline auth or set CLINE_ACCESS_TOKEN. Checked ${providersPath()}.`);
  }

  if (typeof auth.expiresAt === "number" && Date.now() / 1000 >= expirySeconds(auth.expiresAt)) {
    const expiresAt = new Date(expirySeconds(auth.expiresAt) * 1000).toISOString();
    console.warn(`[cline] access token expired at ${expiresAt}. Refresh auth in Cline.`);
  }

  return token;
}
