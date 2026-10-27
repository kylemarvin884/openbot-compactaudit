const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const GREEN = "\u001b[32m";
const BOLD = "\u001b[1m";

export function renderReport(report, { color = false, top = 8, showAll = false, width = 100 } = {}) {
  const paint = (code, text) => (color ? `${code}${text}${RESET}` : text);
  const lines = [];
  const coverage = report.coverage;
  const textLimit = Math.max(40, width - 36);

  lines.push(`${paint(BOLD, `compactaudit ${report.version}`)}`);
  lines.push(
    `transcript  ${report.transcript.path}  (${report.transcript.format}, ${number(report.transcript.messages)} messages, ${number(
      report.transcript.chars,
    )} chars)`,
  );
  const ratio = report.summary.ratio === null ? "" : `, ${percent(report.summary.ratio * 100)} of source text`;
  lines.push(`summary     ${report.summary.source}  (${number(report.summary.chars)} chars${ratio})`);
  lines.push(`scope       ${report.summary.scope}`);
  lines.push("");

  const gradeColor = coverage.percent >= 80 ? GREEN : coverage.percent >= 60 ? YELLOW : RED;
  lines.push(
    `${paint(BOLD, "Coverage")}  ${coverage.kept}/${coverage.total} atoms kept  ${paint(
      gradeColor,
      `(${coverage.percent}%)  grade ${coverage.grade}`,
    )}`,
  );
  lines.push("");

  for (const category of report.categories) {
    if (!category.total) continue;
    const filled = Math.max(0, Math.min(10, Math.round(category.percent / 10)));
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    const categoryColor = category.percent >= 80 ? GREEN : category.percent >= 60 ? YELLOW : RED;
    lines.push(
      `  ${category.name.padEnd(12)}${`${category.kept}/${category.total}`.padEnd(8)}${paint(
        categoryColor,
        bar,
      )}  ${String(category.percent).padStart(3)}%`,
    );
  }

  lines.push("");
  if (report.review.length) {
    const partial = report.partial?.length ?? 0;
    const vanished = report.dropped.length;
    const detail = partial ? `${vanished} dropped, ${partial} partial` : `${vanished} dropped`;
    lines.push(`Need review (${report.review.length} of ${coverage.total}: ${detail})`);
    const shown = showAll ? report.review : report.review.slice(0, top);
    for (const item of shown) {
      const marker = item.status === "partial" ? "~" : "✗";
      const missing =
        item.status === "partial" && item.missing?.length
          ? `   ${paint(DIM, `[missing: ${item.missing.slice(0, 3).join(", ")}]`)}`
          : "";
      lines.push(
        `  ${marker} ${item.category.padEnd(12)}${`${shortRole(item.role)}:${item.line}`.padEnd(15)}${truncate(
          item.text,
          textLimit,
        )}${missing}`,
      );
    }
    if (report.review.length > shown.length) {
      lines.push(`  ${paint(DIM, `... ${report.review.length - shown.length} more (use --all)`)}`);
    }
    lines.push("");
  } else {
    lines.push("Need review (0)");
    lines.push("");
  }

  if (report.firstDrop) {
    lines.push(
      `${paint(BOLD, "first drop")}  ${report.firstDrop.category} (${shortRole(report.firstDrop.role)}, line ${
        report.firstDrop.line
      }): ${truncate(report.firstDrop.text, Math.max(30, width - 42))}`,
    );
    lines.push("");
  }

  if (coverage.pass) {
    const note = coverage.partial ? ` (${coverage.partial} partial, review them)` : "";
    lines.push(
      `verdict  summary kept ${coverage.kept}/${coverage.total} load-bearing atoms (>= ${coverage.threshold}%)${note}`,
    );
  } else {
    lines.push(
      `verdict  ${report.review.length} atoms did not survive compaction - re-read them before continuing`,
    );
  }

  if (coverage.weak) {
    lines.push(
      `note     ${coverage.weak} atom(s) counted as kept by basename/signature only; verify they still point at the same thing`,
    );
  }

  const gate =
    coverage.threshold > 0
      ? `coverage ${coverage.percent}% ${coverage.pass ? ">=" : "<"} --fail-under ${coverage.threshold}`
      : "gate disabled (--fail-under 0)";
  lines.push(`exit     ${coverage.pass ? 0 : 1} (${gate})`);

  return lines.join("\n") + "\n";
}

export function renderQuiet(report) {
  const coverage = report.coverage;
  const partial = report.partial?.length ?? 0;
  const extra = partial ? ` (${report.dropped.length} dropped, ${partial} partial)` : "";
  return `coverage ${coverage.percent}% (${coverage.kept}/${coverage.total}) grade ${coverage.grade} - ${report.review.length} to review${extra}\n`;
}

export function renderJson(report) {
  return JSON.stringify(report, null, 2) + "\n";
}

function percent(value) {
  return `${Math.round(value)}%`;
}

function number(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function shortRole(role) {
  const value = String(role ?? "unknown");
  return value === "assistant" ? "asst" : value;
}

function truncate(text, limit) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, Math.max(1, limit - 1))}…`;
}
