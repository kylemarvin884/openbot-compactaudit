export const CATEGORIES = ["paths", "constraints", "commands", "todos", "failures"];

const EXTENSIONS = new Set(
  "ts tsx js mjs cjs jsx json jsonc md mdx py go rs java kt kts rb php css scss sass less html htm vue svelte astro yml yaml toml ini cfg conf sh bash zsh ps1 sql cs cpp cc cxx c h hpp swift dart ex exs erl clj lua r jl txt env lock gradle properties".split(
    " ",
  ),
);

const NOISE_DIRS =
  /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.nuxt|target|vendor|__pycache__|\.venv|venv|\.cache|out)\//i;

const COMMAND_START =
  /^(npm|npx|pnpm|yarn|bun|node|deno|git|python3?|pip3?|pytest|uv|cargo|go|make|docker|kubectl|gh|curl|wget|rg|grep|find|sed|awk|bash|sh|pwsh|powershell|cmake|dotnet|mvn|gradle|terraform|just|task)\b/;

const CONSTRAINT =
  /\b(must(?:\s+not)?|never|always|do not|don't|required?|only|avoid)\b|必须|不要|不能|禁止|务必|只能|不得/i;

const TODO = /\b(TODO|FIXME|next step|remaining|still need|not yet)\b|未完成|下一步|待办|还需要|尚未/i;

const FAILURE =
  /(^|\s)(FAIL|FAILED|Failure|AssertionError|Traceback|panic:|fatal:|Error:|ERROR\b|exit code [1-9]|\d+ tests? failed|failures?:)/;

const ZERO_FAILURES = /(^|\s)0 (failed|failures|errors)/i;

/**
 * Pull the details that a compaction summary is expected to preserve.
 * Deterministic only: no model, no semantic inference beyond regex + tokens.
 */
export function extractAtoms(messages, { categories = CATEGORIES } = {}) {
  const wanted = new Set(categories);
  const atoms = [];
  const seen = new Set();

  const push = (category, text, message, seq) => {
    if (!wanted.has(category)) return;
    const clean = collapse(text);
    if (!clean) return;
    const key = `${category}:${category === "paths" ? normalizePathKey(clean) : normalizeKey(clean)}`;
    if (seen.has(key)) return;
    seen.add(key);
    atoms.push({
      category,
      text: clean,
      role: message.role,
      line: message.line,
      order: message.order,
      seq,
    });
  };

  for (const message of messages) {
    let seq = 0;

    if (message.role === "user" || message.role === "note" || message.role === "system") {
      for (const sentence of sentences(message.text)) {
        if (sentence.length >= 8 && sentence.length <= 240 && CONSTRAINT.test(sentence) && !isCodeish(sentence)) {
          push("constraints", sentence, message, seq++);
        }
      }
    }

    for (const sentence of sentences(message.text)) {
      if (sentence.length >= 6 && sentence.length <= 240 && TODO.test(sentence)) {
        push("todos", sentence, message, seq++);
      }
    }

    if (message.role !== "tool") {
      for (const token of tokenize(message.text)) {
        const cleaned = cleanPathToken(token);
        if (cleaned) push("paths", cleaned, message, seq++);
      }
      for (const command of inlineCommands(message.text)) {
        push("commands", command, message, seq++);
      }
      for (const line of failureLines(message.text)) {
        push("failures", line, message, seq++);
      }
    }

    for (const call of message.toolCalls ?? []) {
      const name = String(call?.name ?? "");
      const input = call?.input ?? {};

      if (/(bash|shell|exec|command|terminal|run)/i.test(name) && typeof input.command === "string") {
        const command = collapse(input.command);
        if (command && command.length <= 400) push("commands", command, message, seq++);
      }

      const filePath =
        typeof input.file_path === "string"
          ? input.file_path
          : typeof input.filePath === "string"
            ? input.filePath
            : typeof input.path === "string"
              ? input.path
              : null;
      const cleaned = filePath ? cleanPathToken(filePath) : null;
      if (cleaned) push("paths", cleaned, message, seq++);
    }

    for (const result of message.toolResults ?? []) {
      for (const line of failureLines(result)) push("failures", line, message, seq++);
      for (const token of tokenize(result)) {
        // Tool output is noisy; only keep paths that carry a directory.
        const cleaned = cleanPathToken(token);
        if (cleaned && /[\\/]/.test(cleaned)) push("paths", cleaned, message, seq++);
      }
    }
  }

  return atoms.sort((a, b) => a.order - b.order || a.seq - b.seq);
}

export function sentenceList(text) {
  return sentences(text);
}

function sentences(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?。！？；;])\s+|\n+/)
    .map((sentence) => sentence.replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

function isCodeish(sentence) {
  if (/^[{}[\]()<>]/.test(sentence)) return true;
  const symbols = (sentence.match(/[{};=<>]/g) ?? []).length;
  return symbols >= 4;
}

function tokenize(text) {
  if (!text) return [];
  return text.split(/[\s`"'()[\]{}<>,;|]+/).filter(Boolean);
}

export function isPathToken(raw) {
  return cleanPathToken(raw) !== null;
}

/** Return the path with surrounding punctuation removed, or null if it is not a path. */
export function cleanPathToken(raw) {
  const token = String(raw)
    .trim()
    .replace(/^[("'`\[]+/, "")
    .replace(/[)"'`,;]+$/, "")
    .replace(/^:+/, "")
    .replace(/[.:!?]+$/, "")
    .replace(/:\d+(?:-\d+)?$/, "");
  if (!token || token.length > 160) return null;
  if (token.includes("://") || /^https?/i.test(token) || token.startsWith("//")) return null;
  if (/%(20|2F)/i.test(token)) return null;
  if (/^\.env(\.[\w-]+)?$/i.test(token)) return token;

  const normalized = token.replace(/\\/g, "/");
  if (NOISE_DIRS.test(normalized)) return null;
  if (/\.min\.(js|css)$/i.test(normalized)) return null;
  if (/\/(\.{1,2})$/.test(normalized)) return null;

  if (!/^(?:[A-Za-z]:[\\/])?(?:[.~@\w+-]+[\\/])*[.~@\w+-]+\.[A-Za-z0-9]+$/.test(token)) return null;
  const extension = token.split(".").pop().toLowerCase();
  return EXTENSIONS.has(extension) ? token : null;
}

function inlineCommands(text) {
  if (!text) return [];
  const found = [];

  for (const match of text.matchAll(/`([^`\n]{2,160})`/g)) {
    const candidate = match[1].trim();
    if (COMMAND_START.test(candidate)) found.push(candidate);
  }

  for (const match of text.matchAll(/^\s*\$\s+(.{2,160})$/gm)) {
    const candidate = match[1].trim();
    if (COMMAND_START.test(candidate)) found.push(candidate);
  }

  return found;
}

function failureLines(text) {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter((line) => line.length >= 6 && line.length <= 240)
    .filter((line) => FAILURE.test(line) && !ZERO_FAILURES.test(line));
}

function collapse(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePathKey(text) {
  return normalizeKey(text).replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeKey(text) {
  return text.toLowerCase().replace(/[`"'“”‘’]/g, "").replace(/[.,;:!?]+$/, "");
}
