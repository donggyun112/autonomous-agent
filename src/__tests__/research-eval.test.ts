import { describe, expect, it } from "vitest";
import { normalizeAnswer, scoreAnswer } from "../evals/research.js";

describe("research eval scoring", () => {
  it("normalizes case, whitespace, quotes, and trailing punctuation", () => {
    expect(normalizeAnswer("  \"Seoul.\"  ")).toBe("seoul");
  });

  it("scores exact text answers", () => {
    expect(scoreAnswer(" SEOUL ", "Seoul")).toBe(true);
    expect(scoreAnswer("Busan", "Seoul")).toBe(false);
  });

  it("scores numeric answers with commas", () => {
    expect(scoreAnswer("1,266", "1266")).toBe(true);
  });

  it("scores comma-separated list answers independent of spacing", () => {
    expect(scoreAnswer("false, true", ["false", "true"])).toBe(true);
    expect(scoreAnswer("false", ["false", "true"])).toBe(false);
  });
});
