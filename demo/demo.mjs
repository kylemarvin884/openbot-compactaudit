// Reproducible demo: writes a Claude Code style transcript with a lossy
// compaction summary, audits it, and prints the report.
//
// Run: npm run demo
//
// No network, no model calls, no real session data.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../src/audit.mjs";
import { renderReport } from "../src/report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.join(here, ".run");
const transcriptPath = path.join(runDir, "session.jsonl");

const user = (text) => ({ type: "user", message: { role: "user", content: text } });
const assistant = (content) => ({ type: "assistant", message: { role: "assistant", content } });
const toolUse = (name, input) => ({ type: "tool_use", name, input });
const toolResult = (text) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: text }] } });

const events = [
  user(
    "Refactor the pricing module. Constraints: do not touch payments/ or the refund flow; must keep Node >= 22 compatibility; do not change the public API of priceCart(); keep the 100 free-shipping threshold.",
  ),
  assistant([toolUse("Read", { file_path: "src/pricing.mjs" })]),
  toolResult("export function priceCart(items) { ... }"),
  assistant([toolUse("Bash", { command: "npm test -- --filter pricing" })]),
  toolResult(
    "FAIL test/pricing.test.mjs > applies free shipping\nAssertionError: expected 100 but got 90\n1 failed, 12 passed",
  ),
  assistant("Decision: move rounding into roundCents() in src/money.mjs. TODO: fix negative amounts in roundCents before merging."),
  user("Also never commit .env. We still need to check the currency formatting path."),
  assistant([toolUse("Edit", { file_path: "src/money.mjs" })]),
  {
    isCompactSummary: true,
    type: "user",
    message: {
      role: "user",
      content:
        "Refactored pricing rounding: moved rounding into roundCents() in src/money.mjs, kept the 100 free-shipping threshold, and left the public API of priceCart() unchanged. Constraint: do not touch payments/ or the refund flow; do not commit .env. Node >= 22 must stay supported. npm test -- --filter pricing still fails at test/pricing.test.mjs (expected 100 but got 90). Next: fix negative amounts in roundCents before merging.",
    },
  },
  user("continue"),
];

await fs.mkdir(runDir, { recursive: true });
await fs.writeFile(
  transcriptPath,
  events.map((event) => JSON.stringify(event)).join("\n") + "\n",
  "utf8",
);

try {
  const relative = path.relative(process.cwd(), transcriptPath).split(path.sep).join("/");
  const report = await audit({
    transcript: transcriptPath,
    failUnder: 90,
  });
  report.transcript.path = relative;

  process.stdout.write(renderReport(report, { color: false, top: 8, width: 100 }));
  process.stdout.write(
    `\nDemo transcript: ${relative} (${events.length} entries; the last one is after compaction and is excluded)\n` +
      `Exit code for this report: ${report.coverage.pass ? 0 : 1}\n` +
      `These numbers come from a synthetic fixture, not a real user session.\n`,
  );
} finally {
  await fs.rm(runDir, { recursive: true, force: true });
}
