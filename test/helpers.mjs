import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "compactaudit-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

export function jsonl(events) {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
}

export function message(overrides = {}) {
  return {
    order: 0,
    line: 1,
    role: "user",
    text: "",
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

export function capture() {
  const state = { out: "", err: "" };
  return {
    state,
    io: {
      stdout: {
        isTTY: false,
        columns: 100,
        write: (chunk) => {
          state.out += chunk;
        },
      },
      stderr: {
        write: (chunk) => {
          state.err += chunk;
        },
      },
    },
  };
}
