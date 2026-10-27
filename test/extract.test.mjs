import test from "node:test";
import assert from "node:assert/strict";
import { cleanPathToken, extractAtoms, isPathToken } from "../src/extract.mjs";
import { message } from "./helpers.mjs";

test("extracts and dedupes paths, commands, constraints, todos, and failures", () => {
  const messages = [
    message({
      order: 0,
      line: 1,
      role: "user",
      text: "Do not touch payments/ or the refund flow. See src/a.ts:12 and src/a.ts, run `npm test -- --filter pricing`, and never commit .env.",
    }),
    message({
      order: 1,
      line: 2,
      role: "assistant",
      text: "TODO: fix roundCents.\nFAIL test/a.test.mjs > adds tax",
      toolCalls: [{ name: "Bash", input: { command: "npm test -- --filter pricing" } }],
    }),
    message({
      order: 2,
      line: 3,
      role: "user",
      toolResults: ["Error: boom\n0 failed, 1 passed"],
    }),
    message({ order: 3, line: 4, role: "assistant", text: "You must always remember this." }),
  ];

  const atoms = extractAtoms(messages);
  const byCategory = (category) => atoms.filter((atom) => atom.category === category).map((atom) => atom.text);

  assert.deepEqual(byCategory("paths"), ["src/a.ts", ".env", "test/a.test.mjs"]);
  assert.deepEqual(byCategory("commands"), ["npm test -- --filter pricing"]);
  assert.deepEqual(byCategory("constraints"), [
    "Do not touch payments/ or the refund flow.",
    "See src/a.ts:12 and src/a.ts, run `npm test -- --filter pricing`, and never commit .env.",
  ]);
  assert.deepEqual(byCategory("todos"), ["TODO: fix roundCents."]);
  assert.deepEqual(byCategory("failures"), ["FAIL test/a.test.mjs > adds tax", "Error: boom"]);
  assert.ok(!byCategory("constraints").some((text) => /must always/.test(text)), "assistant prose is not a user constraint");
});

test("keeps Chinese constraints and splits on CJK punctuation", () => {
  const atoms = extractAtoms([
    message({ text: "不要修改 config/pricing.json 里的默认值。请继续。", role: "user" }),
  ]);
  const constraints = atoms.filter((atom) => atom.category === "constraints").map((atom) => atom.text);
  assert.equal(constraints.length, 1);
  assert.match(constraints[0], /^不要修改 config\/pricing\.json/);
});

test("filters noise paths and accepts file:line citations", () => {
  assert.equal(cleanPathToken("src/a.ts:12"), "src/a.ts");
  assert.equal(cleanPathToken("src/a.ts:12-18"), "src/a.ts");
  assert.equal(cleanPathToken("(lib/b.mjs),"), "lib/b.mjs");
  assert.equal(cleanPathToken(".env"), ".env");

  assert.equal(isPathToken("https://example.com/a.js"), false);
  assert.equal(isPathToken("node_modules/pkg/index.js"), false);
  assert.equal(isPathToken("dist/bundle.min.js"), false);
  assert.equal(isPathToken("example.com"), false);
  assert.equal(isPathToken("1.2.3"), false);
});

test("stops at the requested categories", () => {
  const atoms = extractAtoms(
    [message({ text: "Do not touch payments/. See src/a.ts. TODO: ship it." })],
    { categories: ["constraints"] },
  );
  assert.deepEqual(
    atoms.map((atom) => atom.category),
    ["constraints"],
  );
});
