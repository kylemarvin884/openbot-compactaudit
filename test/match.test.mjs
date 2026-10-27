import test from "node:test";
import assert from "node:assert/strict";
import { gradeFor, pathKey, scoreAtoms, summarizeCategories } from "../src/match.mjs";
import { message } from "./helpers.mjs";
import { extractAtoms } from "../src/extract.mjs";

function atom(category, text, order = 0) {
  return { category, text, role: "user", line: 1, order, seq: 0 };
}

test("matches full paths, basenames, and rejects extension prefixes", () => {
  const checks = scoreAtoms(
    [atom("paths", "src/a.ts"), atom("paths", "src/b.ts"), atom("paths", "src/c.ts")],
    "We updated src/a.ts and b.ts, not src/c.tsx.",
  );

  assert.equal(checks[0].status, "kept");
  assert.equal(checks[0].weak, false);
  assert.equal(checks[1].status, "kept");
  assert.equal(checks[1].weak, true);
  assert.equal(checks[2].status, "dropped");
});

test("matches commands by full text or two-token signature", () => {
  const checks = scoreAtoms(
    [atom("commands", "npm test -- --filter pricing"), atom("commands", "cargo build --release")],
    "Ran npm test and cargo build --release.",
  );
  assert.equal(checks[0].status, "kept");
  assert.equal(checks[0].weak, true);
  assert.equal(checks[1].status, "kept");
});

test("separates kept, partial, and dropped constraints", () => {
  const checks = scoreAtoms(
    [
      atom("constraints", "do not touch payments/ or the refund flow"),
      atom("constraints", "must keep Node >= 22 compatibility"),
      atom("constraints", "always run the migration against a copy"),
    ],
    "do not touch payments/; Node stays supported.",
  );

  assert.equal(checks[0].status, "partial");
  assert.equal(checks[1].status, "partial");
  assert.equal(checks[2].status, "dropped");
  assert.ok(checks[2].missing.length > 0);
});

test("todos and failures use their own recall thresholds", () => {
  const checks = scoreAtoms(
    [
      atom("todos", "TODO: fix negative amounts in roundCents before merging"),
      atom("failures", "FAIL test/pricing.test.mjs > applies free shipping"),
    ],
    "Next: fix negative amounts in roundCents before merging. test/pricing.test.mjs fails.",
  );

  assert.equal(checks[0].status, "kept");
  assert.equal(checks[1].status, "dropped");
});

test("normalizes path separators for matching", () => {
  assert.equal(pathKey(".\\src\\a.ts"), "src/a.ts");
  assert.equal(pathKey("./src/a.ts"), "src/a.ts");
});

test("summarizes categories and grades without dividing by zero", () => {
  const checks = scoreAtoms(
    extractAtoms([message({ text: "Do not touch payments/. See src/a.ts." })]),
    "nothing relevant",
  );
  const categories = summarizeCategories(checks);
  const paths = categories.find((category) => category.name === "paths");
  assert.equal(paths.percent, 0);

  assert.equal(gradeFor(95), "A");
  assert.equal(gradeFor(81), "B");
  assert.equal(gradeFor(70), "C");
  assert.equal(gradeFor(60), "D");
  assert.equal(gradeFor(59), "F");
});
