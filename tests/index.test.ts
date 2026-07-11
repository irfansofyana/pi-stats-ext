import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import registerPiStats from "../src/index.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type Command = {
  handler(args: string, context: any): Promise<void>;
};

function registeredCommand(): Command {
  let command: Command | undefined;
  registerPiStats({
    registerCommand(name: string, value: Command) {
      assert.equal(name, "pi-stats");
      command = value;
    },
  } as any);
  assert.ok(command);
  return command;
}

async function withAgentDir(run: (agentDir: string) => Promise<void>): Promise<void> {
  const original = process.env.PI_CODING_AGENT_DIR;
  const agentDir = await mkdtemp(join(tmpdir(), "pi-stats-index-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await run(agentDir);
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    await rm(agentDir, { recursive: true, force: true });
  }
}

test("non-TUI command refreshes stats without opening custom UI", async () => {
  await withAgentDir(async (agentDir) => {
    const sessionDir = join(agentDir, "sessions");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "one.jsonl"), [
      JSON.stringify({ type: "session", id: "s1", timestamp: "2026-06-01T10:00:00.000Z", cwd: "/work/project" }),
      JSON.stringify({ type: "message", id: "a1", timestamp: "2026-06-01T10:00:01.000Z", message: { role: "assistant", provider: "p", model: "m", usage: { input: 10, output: 5, cost: { total: 0.01 } } } }),
    ].join("\n"), "utf8");

    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { output.push(args.join(" ")); };
    try {
      await registeredCommand().handler("", {
        mode: "print",
        ui: { custom: () => { throw new Error("custom UI must not open"); } },
      });
    } finally {
      console.log = originalLog;
    }
    assert.match(output.join("\n"), /indexed 1 sessions, 1 usage events/);
  });
});

test("non-TUI command reports an unavailable session root", async () => {
  await withAgentDir(async () => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { output.push(args.join(" ")); };
    try {
      await registeredCommand().handler("", { mode: "json", ui: {} });
    } finally {
      console.log = originalLog;
    }
    assert.match(output.join("\n"), /1 errors/);
  });
});

test("closing the dashboard suppresses late refresh renders", async () => {
  await withAgentDir(async (agentDir) => {
    await mkdir(join(agentDir, "sessions"), { recursive: true });
    let renders = 0;
    await registeredCommand().handler("", {
      mode: "tui",
      ui: {
        async custom(factory: any) {
          const component = factory({ requestRender: () => { renders++; } }, theme, {}, () => {});
          component.handleInput("q");
          await new Promise((resolve) => setTimeout(resolve, 20));
        },
      },
    });
    assert.equal(renders, 0);
  });
});
