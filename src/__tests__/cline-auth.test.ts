import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadClineAccessToken } from "../llm/auth/cline.js";

const BARE_JWT = "eyJhbGciOiJSUzI1NiJ9.payload.sig";

async function writeProvidersFile(accessToken: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cline-auth-test-"));
  const path = join(dir, "providers.json");
  await writeFile(path, JSON.stringify({
    providers: { cline: { settings: { auth: {
      accessToken,
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    } } } },
  }));
  return path;
}

describe("loadClineAccessToken — workos scheme prefix", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["prefixes a bare WorkOS JWT (gateway rejects bare JWTs)", BARE_JWT, `workos:${BARE_JWT}`],
    ["leaves an already-prefixed token unchanged", `workos:${BARE_JWT}`, `workos:${BARE_JWT}`],
    ["leaves non-JWT tokens unchanged", "some-opaque-api-key", "some-opaque-api-key"],
  ])("%s", async (_name, stored, expected) => {
    vi.stubEnv("CLINE_ACCESS_TOKEN", "");
    vi.stubEnv("CLINE_PROVIDERS_PATH", await writeProvidersFile(stored));

    await expect(loadClineAccessToken()).resolves.toBe(expected);
  });

  it("prefixes a bare JWT supplied via CLINE_ACCESS_TOKEN", async () => {
    vi.stubEnv("CLINE_ACCESS_TOKEN", BARE_JWT);

    await expect(loadClineAccessToken()).resolves.toBe(`workos:${BARE_JWT}`);
  });
});
