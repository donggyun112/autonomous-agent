import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadClineAccessToken } from "../llm/auth/cline.js";

async function writeProvidersFile(auth: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cline-auth-test-"));
  const path = join(dir, "providers.json");
  await writeFile(path, JSON.stringify({
    providers: { cline: { settings: { auth } } },
  }));
  return path;
}

describe("loadClineAccessToken — workos scheme prefix", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.CLINE_ACCESS_TOKEN = process.env.CLINE_ACCESS_TOKEN;
    savedEnv.CLINE_PROVIDERS_PATH = process.env.CLINE_PROVIDERS_PATH;
    delete process.env.CLINE_ACCESS_TOKEN;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("prefixes a bare WorkOS JWT with workos: (gateway rejects bare JWTs)", async () => {
    process.env.CLINE_PROVIDERS_PATH = await writeProvidersFile({
      accessToken: "eyJhbGciOiJSUzI1NiJ9.payload.sig",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await expect(loadClineAccessToken()).resolves.toBe("workos:eyJhbGciOiJSUzI1NiJ9.payload.sig");
  });

  it("leaves an already-prefixed token unchanged", async () => {
    process.env.CLINE_PROVIDERS_PATH = await writeProvidersFile({
      accessToken: "workos:eyJhbGciOiJSUzI1NiJ9.payload.sig",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await expect(loadClineAccessToken()).resolves.toBe("workos:eyJhbGciOiJSUzI1NiJ9.payload.sig");
  });

  it("leaves non-JWT tokens unchanged", async () => {
    process.env.CLINE_PROVIDERS_PATH = await writeProvidersFile({
      accessToken: "some-opaque-api-key",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await expect(loadClineAccessToken()).resolves.toBe("some-opaque-api-key");
  });
});
