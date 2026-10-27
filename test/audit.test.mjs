import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { UsageError, audit } from "../src/audit.mjs";
import { jsonl, tempDir } from "./helpers.mjs";

async function writeSession(dir, { withSummary = true } = {}) {
  const file = path.join(dir, "session.jsonl");
  const events = [
    { type: "user", message: { role: "user", content: "Do not touch payments/. Keep Node >= 22." } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "src/a.ts" } }] } },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] },
    },
  ];
  if (withSummary) {
    events.push({ isCompactSummary: true, type: "user", message: { role: "user", content: "We worked on src/a.ts." } });
    events.push({ type: "user", message: { role: "user", content: "continue" } });
  }
  await fs.writeFile(file, jsonl(events));
  return file;
}

test("audits only the messages before the compaction summary", async (t) => {
  const dir = await tempDir(t);
  const file = await writeSession(dir);

  const report = await audit({ transcript: file, failUnder: 0 });
  assert.equal(report.transcript.messages, 3);
  assert.equal(report.transcript.totalMessages, 4);
  assert.match(report.summary.scope, /before line 4/);
  assert.equal(report.summary.source, "inline at line 4");
  assert.ok(report.coverage.total > 0);
  assert.equal(report.checks.length, report.coverage.total);
  assert.ok(report.checks.every((check) => ["kept", "partial", "dropped"].includes(check.status)));
  assert.equal(report.coverage.pass, true);
  assert.ok(report.review.every((item) => item.status !== "kept"));
  assert.deepEqual(
    report.dropped.map((item) => item.order),
    [...report.dropped.map((item) => item.order)].sort((a, b) => a - b),
  );
});

test("applies the coverage gate", async (t) => {
  const dir = await tempDir(t);
  const file = await writeSession(dir);

  const strict = await audit({ transcript: file, failUnder: 100 });
  assert.equal(strict.coverage.pass, false);
  assert.equal(strict.coverage.threshold, 100);
});

test("uses an explicit summary and the whole transcript when it has no compaction entry", async (t) => {
  const dir = await tempDir(t);
  const file = await writeSession(dir, { withSummary: false });
  const summaryFile = path.join(dir, "summary.md");
  await fs.writeFile(summaryFile, "Touched src/a.ts and ran npm test. Payments stays untouched; Node 22.");

  const report = await audit({ transcript: file, summary: summaryFile, failUnder: 0 });
  assert.equal(report.transcript.messages, 3);
  assert.equal(report.summary.scope, "all messages");
  assert.equal(report.summary.source, summaryFile);
});

test("explains what is missing instead of guessing", async (t) => {
  const dir = await tempDir(t);
  const noSummary = await writeSession(dir, { withSummary: false });
  await assert.rejects(() => audit({ transcript: noSummary }), /no compaction summary found/);

  const chatFile = path.join(dir, "chat.jsonl");
  await fs.writeFile(
    chatFile,
    jsonl([
      { type: "user", message: { role: "user", content: "hello there" } },
      { isCompactSummary: true, type: "user", message: { role: "user", content: "we said hello" } },
    ]),
  );
  await assert.rejects(() => audit({ transcript: chatFile }), /nothing to audit/);
  await assert.rejects(() => audit({ transcript: noSummary, summary: path.join(dir, "nope.md") }));
  await assert.rejects(() => audit({}), UsageError);
});
