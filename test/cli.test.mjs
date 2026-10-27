import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { main } from "../src/cli.mjs";
import { capture, jsonl, tempDir } from "./helpers.mjs";

async function fixture(dir) {
  const file = path.join(dir, "session.jsonl");
  await fs.writeFile(
    file,
    jsonl([
      { type: "user", message: { role: "user", content: "Do not touch payments/. See src/a.ts." } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } },
      { isCompactSummary: true, type: "user", message: { role: "user", content: "done" } },
    ]),
  );
  return file;
}

test("prints help and version", async () => {
  const help = capture();
  assert.equal(await main(["--help"], help.io), 0);
  assert.match(help.state.out, /Usage:/);
  assert.match(help.state.out, /--fail-under/);

  const version = capture();
  assert.equal(await main(["--version"], version.io), 0);
  assert.match(version.state.out, /^\d+\.\d+\.\d+/);
});

test("rejects bad usage with exit code 2", async () => {
  const missing = capture();
  assert.equal(await main([], missing.io), 2);
  assert.match(missing.state.err, /missing transcript path/);

  const unknown = capture();
  assert.equal(await main(["audit", "x.jsonl", "--wat"], unknown.io), 2);
  assert.match(unknown.state.err, /unknown option/);

  const category = capture();
  assert.equal(await main(["audit", "x.jsonl", "--category=a,b"], category.io), 2);
  assert.match(category.state.err, /--category/);

  const noValue = capture();
  assert.equal(await main(["audit", "x.jsonl", "--summary"], noValue.io), 2);
  assert.match(noValue.state.err, /--summary needs a value/);
});

test("emits JSON and honours --fail-under=0", async (t) => {
  const dir = await tempDir(t);
  const file = await fixture(dir);

  const run = capture();
  assert.equal(await main(["audit", file, "--json", "--fail-under", "0"], run.io), 0);
  const report = JSON.parse(run.state.out);
  assert.equal(report.transcript.path, file);
  assert.ok(report.coverage.total >= 3);
  assert.equal(report.coverage.threshold, 0);
  assert.ok(report.checks.some((check) => check.status === "dropped"));
});

test("fails the default gate on a lossy summary and explains the drops", async (t) => {
  const dir = await tempDir(t);
  const file = await fixture(dir);

  const run = capture();
  assert.equal(await main([file], run.io), 1);
  assert.match(run.state.out, /Coverage/);
  assert.match(run.state.out, /Need review/);
  assert.match(run.state.out, /payments/);
  assert.match(run.state.out, /--fail-under 60/);
});

test("supports a quiet summary line and an explicit summary file", async (t) => {
  const dir = await tempDir(t);
  const file = await fixture(dir);
  const summaryFile = path.join(dir, "summary.md");
  await fs.writeFile(summaryFile, "Untouched payments. src/a.ts read. npm test run.");

  const quiet = capture();
  assert.equal(await main(["audit", file, "--summary", summaryFile, "--quiet"], quiet.io), 0);
  assert.match(quiet.state.out, /^coverage \d+% \(\d+\/\d+\) grade [A-F] - \d+ to review/);
});

test("explains a missing summary instead of reporting zero coverage", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "plain.jsonl");
  await fs.writeFile(
    file,
    jsonl([{ type: "user", message: { role: "user", content: "Do not touch payments/. See src/a.ts." } }]),
  );

  const run = capture();
  assert.equal(await main([file], run.io), 2);
  assert.match(run.state.err, /no compaction summary found/);
});
