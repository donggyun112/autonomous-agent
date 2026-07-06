import { readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

type ClineAuth = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  email?: string;
  metadata?: Record<string, unknown>;
};

type ClineProvidersFile = {
  providers?: {
    cline?: {
      settings?: {
        auth?: ClineAuth;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ClineRefreshResponse = {
  success?: boolean;
  data?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    tokenType?: string;
    userInfo?: {
      clineUserId?: string;
      email?: string;
      [key: string]: unknown;
    };
  };
  error?: unknown;
  message?: string;
};

function providersPath(): string {
  return process.env.CLINE_PROVIDERS_PATH ??
    join(homedir(), ".cline", "data", "settings", "providers.json");
}

function expirySeconds(expiresAt: number): number {
  return expiresAt > 10_000_000_000 ? expiresAt / 1000 : expiresAt;
}

function clineApiBaseUrl(): string {
  const raw = process.env.CLINE_API_BASE_URL?.trim()
    || process.env.CLINE_BASE_URL?.trim()
    || "https://api.cline.bot";
  return raw.replace(/\/api\/?$/, "").replace(/\/$/, "");
}

function isExpiring(auth: ClineAuth, skewMs = 60_000): boolean {
  if (typeof auth.expiresAt !== "number") return false;
  return Date.now() + skewMs >= expirySeconds(auth.expiresAt) * 1000;
}

async function loadProvidersFile(): Promise<ClineProvidersFile> {
  const text = await readFile(providersPath(), "utf-8");
  return JSON.parse(text) as ClineProvidersFile;
}

async function saveProvidersFile(data: ClineProvidersFile): Promise<void> {
  const path = providersPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

async function loadAuthFromProvidersFile(): Promise<ClineAuth> {
  const data = await loadProvidersFile();
  return data.providers?.cline?.settings?.auth ?? {};
}

async function saveAuthToProvidersFile(auth: ClineAuth): Promise<void> {
  const data = await loadProvidersFile();
  data.providers ??= {};
  data.providers.cline ??= {};
  const clineProvider = data.providers.cline;
  clineProvider.settings ??= {};
  clineProvider.settings.auth = auth;
  await saveProvidersFile(data);
}

async function refreshClineAccessToken(auth: ClineAuth): Promise<ClineAuth> {
  const refreshToken = auth.refreshToken?.trim();
  if (!refreshToken) {
    throw new Error("Cline access token expired and providers.json has no refreshToken. Re-authenticate Cline.");
  }

  const res = await fetch(`${clineApiBaseUrl()}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken, grantType: "refresh_token" }),
    signal: AbortSignal.timeout(Number(process.env.CLINE_AUTH_TIMEOUT_MS ?? 30_000)),
  });
  const json = await res.json().catch(() => ({})) as ClineRefreshResponse;
  if (!res.ok || !json.success || !json.data?.accessToken || !json.data.expiresAt) {
    const msg = typeof json.message === "string"
      ? json.message
      : typeof json.error === "string"
        ? json.error
        : `HTTP ${res.status}`;
    throw new Error(`Cline token refresh failed: ${msg}. Re-authenticate Cline.`);
  }

  const expires = Date.parse(json.data.expiresAt);
  if (Number.isNaN(expires)) {
    throw new Error(`Cline token refresh returned invalid expiresAt: ${json.data.expiresAt}`);
  }

  const nextAuth: ClineAuth = {
    ...auth,
    accessToken: json.data.accessToken,
    refreshToken: json.data.refreshToken ?? auth.refreshToken,
    expiresAt: expires,
    accountId: json.data.userInfo?.clineUserId ?? auth.accountId,
    email: json.data.userInfo?.email ?? auth.email,
    metadata: {
      ...auth.metadata,
      provider: "cline",
      tokenType: json.data.tokenType,
      userInfo: json.data.userInfo,
    },
  };
  await saveAuthToProvidersFile(nextAuth);
  return nextAuth;
}

let refreshInFlight: Promise<ClineAuth> | null = null;

export async function refreshClineCredentials(): Promise<boolean> {
  if (process.env.CLINE_ACCESS_TOKEN?.trim()) return false;
  const auth = await loadAuthFromProvidersFile();
  refreshInFlight ??= refreshClineAccessToken(auth).finally(() => {
    refreshInFlight = null;
  });
  await refreshInFlight;
  return true;
}

export async function loadClineAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  const envToken = process.env.CLINE_ACCESS_TOKEN?.trim();
  if (envToken) return envToken;

  let auth = await loadAuthFromProvidersFile();
  if (options?.forceRefresh || isExpiring(auth)) {
    if (typeof auth.expiresAt === "number" && isExpiring(auth, 0)) {
      const expiresAt = new Date(expirySeconds(auth.expiresAt) * 1000).toISOString();
      console.warn(`[cline] access token expired at ${expiresAt}; refreshing with stored refresh token.`);
    }
    refreshInFlight ??= refreshClineAccessToken(auth).finally(() => {
      refreshInFlight = null;
    });
    auth = await refreshInFlight;
  }

  const token = auth.accessToken?.trim();
  if (!token) {
    throw new Error(`No Cline auth. Run Cline auth or set CLINE_ACCESS_TOKEN. Checked ${providersPath()}.`);
  }

  return token;
}
