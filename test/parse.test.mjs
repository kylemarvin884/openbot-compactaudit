import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { UsageError, parseSource } from "../src/parse.mjs";
import { jsonl, tempDir } from "./helpers.mjs";

test("parses Claude Code JSONL and finds the inline compaction summary", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "session.jsonl");
  await fs.writeFile(
    file,
    jsonl([
      { type: "user", message: { role: "user", content: "Fix the cart." } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Reading files." },
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
      },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "FAIL one test" }] } },
      { isCompactSummary: true, type: "user", message: { role: "user", content: "Summary text." } },
    ]),
  );

  const parsed = await parseSource(file);
  assert.equal(parsed.format, "jsonl");
  assert.equal(parsed.messages.length, 3);
  assert.equal(parsed.messages[0].role, "user");
  assert.equal(parsed.messages[0].text, "Fix the cart.");
  assert.equal(parsed.messages[1].text, "Reading files.");
  assert.equal(parsed.messages[1].toolCalls[0].name, "Bash");
  assert.equal(parsed.messages[2].toolResults[0], "FAIL one test");
  assert.ok(parsed.summary);
  assert.equal(parsed.summary.text, "Summary text.");
  assert.equal(parsed.summary.line, 4);
});

test("reads summary entries written as a separate object", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "session.jsonl");
  await fs.writeFile(
    file,
    jsonl([
      { type: "user", message: { role: "user", content: "do the thing" } },
      { type: "summary", summary: "we did the thing" },
    ]),
  );

  const parsed = await parseSource(file);
  assert.equal(parsed.summaries.length, 1);
  assert.equal(parsed.summary.text, "we did the thing");
});

test("falls back to plain text paragraphs", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "session.txt");
  await fs.writeFile(file, "First note about src/a.ts.\n\nSecond note about npm test.\n");

  const parsed = await parseSource(file);
  assert.equal(parsed.format, "text");
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].role, "note");
  assert.match(parsed.messages[1].text, /npm test/);
  assert.equal(parsed.summary, null);
});

test("rejects empty and unreadable transcripts with a UsageError", async (t) => {
  const dir = await tempDir(t);
  const empty = path.join(dir, "empty.jsonl");
  await fs.writeFile(empty, "\n\n");

  await assert.rejects(() => parseSource(empty), UsageError);
  await assert.rejects(() => parseSource(path.join(dir, "missing.jsonl")));
});
