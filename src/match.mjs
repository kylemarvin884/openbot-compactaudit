import { CATEGORIES } from "./extract.mjs";

const STOPWORDS = new Set(
  `the and for are was were been being with from this that these those have has had will would should
   could may might must never always only also just make made your yours there their then than when what
   which while about into over under after before does doesn't don't not you our out all any but can
   required avoid todo fixme next step still need remaining not yet done use used using add added
   keep keeps kept change changes changed file files code test tests`
    .split(/\s+/)
    .filter(Boolean),
);

const RECALL = {
  constraints: 0.65,
  todos: 0.6,
  failures: 0.5,
};

export function normalize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function pathKey(text) {
  return normalize(text)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

export function terms(text) {
  const source = normalize(text);
  const result = new Set();

  for (const match of source.matchAll(/[a-z0-9][a-z0-9_./-]*/g)) {
    const word = match[0].replace(/[./-]+$/, "");
    if (word.length < 4) continue;
    if (STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    result.add(word);
  }

  for (const match of source.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = match[0];
    if (run.length === 1) {
      result.add(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      result.add(run.slice(index, index + 2));
    }
  }

  return result;
}

export function commandSignature(command) {
  const tokens = normalize(command).split(" ").filter(Boolean);
  return tokens.slice(0, 2).join(" ");
}

export function scoreAtoms(atoms, summaryText) {
  const summary = normalize(summaryText);
  const summaryFlat = summary.replace(/\\/g, "/");
  const summaryTerms = terms(summaryText);

  return atoms.map((atom) => {
    if (atom.category === "paths") {
      const key = pathKey(atom.text);
      const base = key.split("/").pop();
      if (includesPath(summaryFlat, key)) {
        return { ...atom, status: "kept", kept: true, weak: false, recall: 1, missing: [] };
      }
      if (base && base.includes(".") && includesPath(summaryFlat, base)) {
        return { ...atom, status: "kept", kept: true, weak: true, recall: 0.5, missing: [] };
      }
      return { ...atom, status: "dropped", kept: false, weak: false, recall: 0, missing: [key] };
    }

    if (atom.category === "commands") {
      const full = normalize(atom.text);
      if (includesCommand(summary, full)) {
        return { ...atom, status: "kept", kept: true, weak: false, recall: 1, missing: [] };
      }
      const signature = commandSignature(atom.text);
      if (signature && includesCommand(summary, signature)) {
        return { ...atom, status: "kept", kept: true, weak: true, recall: 0.5, missing: [] };
      }
      return { ...atom, status: "dropped", kept: false, weak: false, recall: 0, missing: [signature || full] };
    }

    const wanted = terms(atom.text);
    if (!wanted.size) {
      const kept = summary.includes(normalize(atom.text));
      return {
        ...atom,
        status: kept ? "kept" : "dropped",
        kept,
        weak: false,
        recall: kept ? 1 : 0,
        missing: [],
      };
    }

    const missing = [...wanted].filter((term) => !summaryTerms.has(term));
    const recall = (wanted.size - missing.length) / wanted.size;
    const threshold = RECALL[atom.category] ?? 0.65;
    const kept = recall >= threshold;
    return {
      ...atom,
      status: kept ? "kept" : recall >= 0.4 ? "partial" : "dropped",
      kept,
      weak: false,
      recall: Number(recall.toFixed(3)),
      missing: missing.slice(0, 6),
    };
  });
}

export function summarizeCategories(checks) {
  return CATEGORIES.map((name) => {
    const rows = checks.filter((check) => check.category === name);
    const kept = rows.filter((row) => row.kept).length;
    return {
      name,
      kept,
      total: rows.length,
      percent: rows.length ? Math.round((kept / rows.length) * 100) : null,
    };
  });
}

export function gradeFor(percent) {
  if (percent >= 90) return "A";
  if (percent >= 80) return "B";
  if (percent >= 70) return "C";
  if (percent >= 60) return "D";
  return "F";
}

function includesPath(haystack, needle) {
  if (!needle) return false;
  // A trailing sentence period is fine; a path that continues (a.ts -> a.tsx) is not.
  return new RegExp(`${escapeRegExp(needle)}(?![\\w/\\\\-])`).test(haystack);
}

function includesCommand(haystack, needle) {
  if (!needle) return false;
  return new RegExp(`${escapeRegExp(needle)}(?![a-z0-9_-])`).test(haystack);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
