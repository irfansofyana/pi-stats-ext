import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, parseRange, parseSessionText, refreshCache } from "../src/stats.js";

const sessionA = `
{"type":"session","version":3,"id":"s1","timestamp":"2026-06-01T10:00:00.000Z","cwd":"/work/pi-stats-ext"}
{"type":"message","id":"u1","timestamp":"2026-06-01T10:00:01.000Z","message":{"role":"user","content":"Build stats"}}
{"type":"message","id":"a1","timestamp":"2026-06-01T10:00:02.000Z","message":{"role":"assistant","provider":"anthropic","model":"claude-sonnet","timestamp":1780308002000,"usage":{"input":100,"output":50,"cacheRead":25,"cacheWrite":10,"totalTokens":185,"cost":{"total":0.02}}}}
{"type":"session_info","id":"n1","timestamp":"2026-06-01T10:00:03.000Z","name":"Stats MVP"}
`;

const sessionB = `
{"type":"session","version":3,"id":"s2","timestamp":"2026-06-02T10:00:00.000Z","cwd":"/work/other"}
{"type":"message","id":"a2","timestamp":"2026-06-02T10:00:02.000Z","message":{"role":"assistant","provider":"openai","model":"gpt-5","timestamp":1780394402000,"usage":{"input":200,"output":80,"cacheRead":0,"cacheWrite":20,"totalTokens":300,"cost":{"total":0.04}}}}
`;

test("parses Pi session usage events", () => {
  const parsed = parseSessionText(sessionA, "/tmp/s1.jsonl");
  assert.equal(parsed.sessionId, "s1");
  assert.equal(parsed.sessionName, "Stats MVP");
  assert.equal(parsed.project, "pi-stats-ext");
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0]!.freshTokens, 160);
  assert.equal(parsed.events[0]!.totalTokens, 185);
  assert.equal(parsed.events[0]!.cost, 0.02);
});

test("aggregates date range, models, projects, and sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-stats-"));
  try {
    const sessionDir = join(root, "sessions");
    await writeFile(join(sessionDir, "one.jsonl"), sessionA, { encoding: "utf8", flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      await import("node:fs/promises").then(({ mkdir }) => mkdir(sessionDir, { recursive: true }));
      await writeFile(join(sessionDir, "one.jsonl"), sessionA, "utf8");
    });
    await writeFile(join(sessionDir, "two.jsonl"), sessionB, "utf8");

    const result = await refreshCache(sessionDir, join(root, "cache.json"));
    assert.equal(result.totalFiles, 2);
    assert.equal(result.parsedFiles, 2);

    const stats = aggregate(result.cache, { label: "custom", start: Date.parse("2026-06-01T00:00:00.000Z"), end: Date.parse("2026-06-03T00:00:00.000Z") });
    assert.equal(stats.totals.input, 300);
    assert.equal(stats.totals.output, 130);
    assert.equal(stats.totals.cacheWrite, 30);
    assert.equal(stats.totals.freshTokens, 460);
    assert.equal(stats.totals.cost, 0.06);
    assert.equal(stats.activeDays, 2);
    assert.equal(stats.models[0]!.label, "gpt-5");
    assert.equal(stats.projects[0]!.label, "other");
    assert.equal(stats.sessions.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reuses unchanged cached session files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-stats-cache-"));
  try {
    const sessionDir = join(root, "sessions");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(sessionDir, { recursive: true }));
    await writeFile(join(sessionDir, "one.jsonl"), sessionA, "utf8");
    const cachePath = join(root, "cache.json");

    await refreshCache(sessionDir, cachePath);
    const second = await refreshCache(sessionDir, cachePath);
    assert.equal(second.parsedFiles, 0);
    assert.equal(second.reusedFiles, 1);
    const raw = await readFile(cachePath, "utf8");
    assert.match(raw, /Stats MVP/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parses supported ranges", () => {
  const now = Date.parse("2026-06-28T12:00:00.000Z");
  assert.equal(parseRange("", now).label, "last 30d");
  assert.equal(parseRange("today", now).label, "today");
  assert.equal(parseRange("today", now).start, Date.parse("2026-06-28T00:00:00.000Z"));
  assert.equal(parseRange("today", now).end, Date.parse("2026-06-29T00:00:00.000Z"));
  assert.equal(parseRange("7", now).label, "last 7d");
  assert.equal(parseRange("all", now).label, "all time");
  assert.equal(parseRange("2026-06-01..2026-06-03", now).label, "2026-06-01..2026-06-03");
  assert.equal(parseRange("2026-06-28..2026-06-28", now).start, Date.parse("2026-06-28T00:00:00.000Z"));
  assert.equal(parseRange("2026-06-28..2026-06-28", now).end, Date.parse("2026-06-29T00:00:00.000Z"));
});
