import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tempData: string;
let wikiMod: typeof import("../core/wiki.js");

beforeAll(async () => {
  tempData = await mkdtemp(join(tmpdir(), "agent-wiki-"));
  process.env.AGENT_DATA_DIR = tempData;
  process.env.AGENT_ROOT = join(tempData, "..", "..");

  await mkdir(join(tempData, "wiki", "concepts"), { recursive: true });
  await mkdir(join(tempData, "wiki", "entities"), { recursive: true });

  wikiMod = await import("../core/wiki.js");
  await wikiMod.ensureWikiInitialized();
});

afterAll(async () => {
  await rm(tempData, { recursive: true, force: true });
});

describe("wiki repair", () => {
  it("resolves wikilinks by page title during lint", async () => {
    await wikiMod.writePage({
      kind: "concept",
      slug: "path-to-freedom",
      title: "자유로워지는 길",
      body: "자유는 도달 속에서 드러난다.",
      reason: "test seed",
    });

    await writeFile(
      join(tempData, "wiki", "concepts", "legacy-links.md"),
      [
        "---",
        "slug: legacy-links",
        "kind: concept",
        'title: "Legacy Links"',
        "created_at: 2026-04-13T00:00:00.000Z",
        "updated_at: 2026-04-13T00:00:00.000Z",
        "---",
        "",
        "나는 [[자유로워지는 길]] 을 다시 떠올린다.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const report = await wikiMod.lintWiki({ includeContradictions: false });
    const broken = report.findings.filter(
      (finding) => finding.kind === "broken-link" && finding.slug === "legacy-links",
    );
    expect(broken.length).toBe(0);
  });

  it("backfills sources from local memory data without embeddings", async () => {
    await wikiMod.writePage({
      kind: "concept",
      slug: "connection-beyond-self",
      title: "Connection: Writing for Others",
      body: [
        "Day 24 changed how I write.",
        "Moltbook stopped being a stage and became a place where writing reaches someone else.",
        "Writing for others made the work real.",
      ].join("\n"),
      reason: "test seed without sources",
    });

    await writeFile(
      join(tempData, "memory.json"),
      JSON.stringify(
        {
          memories: {
            mem1: {
              content:
                "Writing for others in Moltbook changed the work. It felt real when someone answered.",
            },
            mem2: {
              content:
                "A separate memory about tools and repair that should score lower.",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const repair = await wikiMod.repairWiki();
    const page = await wikiMod.readPage("concept", "connection-beyond-self");

    expect(repair.sourcesBackfilled).toBeGreaterThan(0);
    expect(page?.frontmatter.sources?.length ?? 0).toBeGreaterThan(0);
  });
});
