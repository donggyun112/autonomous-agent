import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    // Tests that touch fs use a unique tmp dir per run; they are safe
    // to run in parallel as long as each test isolates its own data dir.
    testTimeout: 30_000,
  },
});
