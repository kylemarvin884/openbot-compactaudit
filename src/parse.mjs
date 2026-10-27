import fs from "node:fs/promises";
import path from "node:path";

export const VERSION = "0.1.0";

export class UsageError extends Error {}

const TEXT_ROLES = new Set(["user", "assistant", "system", "tool", "note"]);

/**
 * Read a transcript. Two formats are supported:
 *  - JSONL: one JSON object per line, Claude Code / Codex style
 *  - plain text / Markdown: paragraphs become "note" messages
 *
 * Returns messages in source order plus any compaction summary entries found
 * inside the transcript (Claude Code stores them as isCompactSummary entries).
 */
export async function parseSource(file) {
  const raw = await fs.readFile(file, "utf8");
  if (!raw.trim()) throw new UsageError(`transcript is empty: ${file}`);

  const lines = raw.split(/\r?\n/);
  const entries = [];
  let nonEmpty = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    nonEmpty += 1;
    try {
      entries.push({ value: JSON.parse(line), line: index + 1 });
    } catch {
      // handled by the ratio check below
    }
  }

  const looksJsonl = nonEmpty > 0 && entries.length / nonEmpty >= 0.6;
  const parsed = looksJsonl
    ? fromJsonl(entries, { file, raw })
    : fromText(raw, { file });

  if (!parsed.messages.length) throw new UsageError(`transcript has no readable messages: ${file}`);
  return parsed;
}

function fromJsonl(entries, { file, raw }) {
  const messages = [];
  const summaries = [];

  for (const { value, line } of entries) {
    if (!value || typeof value !== "object") continue;

    const summaryText = readSummary(value);
    if (summaryText !== null) {
      if (summaryText.trim()) {
        summaries.push({ order: messages.length, line, text: summaryText.trim() });
      }
      continue;
    }

    const message = value.message && typeof value.message === "object" ? value.message : value;
    const role = normalizeRole(message.role ?? value.type);
    const parts = flattenContent(message.content ?? value.content ?? value.text);

    if (!parts.text.trim() && !parts.toolCalls.length && !parts.toolResults.length) continue;

    messages.push({
      order: messages.length,
      line,
      role,
      text: parts.text.trim(),
      toolCalls: parts.toolCalls,
      toolResults: parts.toolResults,
    });
  }

  return {
    file,
    format: "jsonl",
    chars: raw.length,
    bytes: Buffer.byteLength(raw, "utf8"),
    messages,
    summaries,
    summary: summaries.length ? summaries[summaries.length - 1] : null,
  };
}

function fromText(raw, { file }) {
  const messages = [];
  const blocks = raw.split(/\r?\n[ \t]*\r?\n/);
  let cursor = 0;

  for (const block of blocks) {
    const text = block.trim();
    const index = text ? raw.indexOf(block, cursor) : -1;
    if (text) cursor = index + block.length;
    if (!text) continue;
    const heading = /^#{1,6}\s+(summary|compaction|compact summary)/i.test(text);
    if (heading) continue;
    const line = index < 0 ? 1 : raw.slice(0, index).split(/\r?\n/).length;
    messages.push({
      order: messages.length,
      line,
      role: "note",
      text,
      toolCalls: [],
      toolResults: [],
    });
  }

  return {
    file,
    format: "text",
    chars: raw.length,
    bytes: Buffer.byteLength(raw, "utf8"),
    messages,
    summaries: [],
    summary: null,
  };
}

function readSummary(entry) {
  if (entry.isCompactSummary === true) {
    return flattenContent(entry.message?.content ?? entry.content ?? entry.text).text;
  }
  if (entry.type === "summary" && typeof entry.summary === "string") return entry.summary;
  if (entry.type === "compaction" && typeof entry.summary === "string") return entry.summary;
  if (entry.type === "compact_boundary" && typeof entry.summary === "string") return entry.summary;
  return null;
}

function normalizeRole(role) {
  const value = String(role ?? "").toLowerCase();
  if (TEXT_ROLES.has(value)) return value;
  if (value === "human") return "user";
  if (value === "ai" || value === "model") return "assistant";
  return value || "unknown";
}

function flattenContent(content) {
  const result = { text: "", toolCalls: [], toolResults: [] };
  if (content == null) return result;

  if (typeof content === "string") {
    result.text = content;
    return result;
  }

  if (Array.isArray(content)) {
    const chunks = [];
    for (const part of content) {
      if (typeof part === "string") {
        chunks.push(part);
        continue;
      }
      if (!part || typeof part !== "object") continue;

      if (part.type === "text" && typeof part.text === "string") {
        chunks.push(part.text);
      } else if (part.type === "thinking" || part.type === "redacted_thinking") {
        continue;
      } else if (part.type === "tool_use") {
        result.toolCalls.push({ name: String(part.name ?? ""), input: part.input ?? {} });
      } else if (part.type === "tool_result") {
        result.toolResults.push(flattenToolResult(part.content));
      } else if (typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
    result.text = chunks.join("\n");
    return result;
  }

  if (typeof content === "object") {
    result.text = typeof content.text === "string" ? content.text : "";
  }
  return result;
}

function flattenToolResult(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.type === "text" ? String(part.text ?? "") : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object" && typeof content.text === "string") return content.text;
  return "";
}

export function displayPath(file) {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith("..") ? relative : path.basename(file);
}
