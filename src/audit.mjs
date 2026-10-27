import fs from "node:fs/promises";
import { parseSource, UsageError, VERSION } from "./parse.mjs";
import { extractAtoms, CATEGORIES } from "./extract.mjs";
import { gradeFor, scoreAtoms, summarizeCategories } from "./match.mjs";

export { UsageError };

/**
 * Compare the facts in a transcript against the compaction summary that
 * replaced it. Everything is local and deterministic.
 */
export async function audit({
  transcript,
  summary,
  failUnder = 60,
  categories = CATEGORIES,
  now = new Date(),
}) {
  if (!transcript) throw new UsageError("missing transcript path");
  const parsed = await parseSource(transcript);
  const boundary = parsed.summary;

  let summaryText;
  let summarySource;
  if (summary) {
    summaryText = (await fs.readFile(summary, "utf8")).trim();
    if (!summaryText) throw new UsageError(`summary file is empty: ${summary}`);
    summarySource = summary;
  } else if (boundary) {
    summaryText = boundary.text;
    summarySource = `inline at line ${boundary.line}`;
  } else {
    throw new UsageError(
      "no compaction summary found in the transcript; pass --summary <file> or use a transcript with an isCompactSummary entry",
    );
  }

  const scope = boundary ? parsed.messages.filter((message) => message.order < boundary.order) : parsed.messages;
  if (!scope.length) throw new UsageError("no messages before the compaction summary");

  const atoms = extractAtoms(scope, { categories });
  if (!atoms.length) {
    throw new UsageError(
      `nothing to audit: no ${categories.join(" / ")} found in ${scope.length} source messages`,
    );
  }

  const checks = scoreAtoms(atoms, summaryText);
  const kept = checks.filter((check) => check.kept).length;
  const total = checks.length;
  const percent = Math.round((kept / total) * 100);
  const sourceChars = scope.reduce(
    (sum, message) =>
      sum + message.text.length + (message.toolResults ?? []).reduce((inner, result) => inner + result.length, 0),
    0,
  );

  const review = checks
    .filter((check) => !check.kept)
    .sort((a, b) => a.order - b.order || a.seq - b.seq);
  const dropped = review.filter((check) => check.status === "dropped");
  const partial = review.filter((check) => check.status === "partial");

  return {
    version: VERSION,
    generatedAt: now.toISOString(),
    transcript: {
      path: transcript,
      format: parsed.format,
      messages: scope.length,
      totalMessages: parsed.messages.length,
      chars: sourceChars,
    },
    summary: {
      source: summarySource,
      chars: summaryText.length,
      ratio: sourceChars ? Number((summaryText.length / sourceChars).toFixed(3)) : null,
      scope: boundary ? `messages before line ${boundary.line}` : "all messages",
    },
    coverage: {
      kept,
      total,
      percent,
      grade: gradeFor(percent),
      threshold: failUnder,
      pass: percent >= failUnder,
      weak: checks.filter((check) => check.kept && check.weak).length,
      partial: partial.length,
    },
    categories: summarizeCategories(checks),
    checks,
    review,
    dropped,
    partial,
    firstDrop: dropped[0] ?? null,
  };
}
