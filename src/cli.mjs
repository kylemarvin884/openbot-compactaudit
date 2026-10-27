#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { audit } from "./audit.mjs";
import { CATEGORIES } from "./extract.mjs";
import { UsageError, VERSION } from "./parse.mjs";
import { renderJson, renderQuiet, renderReport } from "./report.mjs";

const HELP = `compactaudit ${VERSION} - audit what a compaction summary dropped

Usage:
  compactaudit audit <transcript> [options]
  compactaudit <transcript> [options]

Options:
  --summary <file>        compare against this summary instead of the one inline in the transcript
  --fail-under <n>        exit 1 when coverage is below n percent (default: 60, 0 disables the gate)
  --category <list>       only check these categories: ${CATEGORIES.join(",")}
  --top <n>               show n dropped atoms (default: 8)
  --all                   show every dropped atom
  --json                  machine-readable output
  --quiet                 one summary line only
  --no-color              disable ANSI colors
  -h, --help              show this help
  -v, --version           print version

Exit codes:
  0  coverage at or above --fail-under
  1  coverage below --fail-under
  2  bad usage, unreadable input, or no summary found
`;

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`compactaudit: ${error.message}\n`);
    return 2;
  }

  if (options.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (options.version) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (!options.transcript) {
    io.stderr.write(`compactaudit: missing transcript path\n\n${HELP}`);
    return 2;
  }

  try {
    const report = await audit({
      transcript: options.transcript,
      summary: options.summary,
      failUnder: options.failUnder,
      categories: options.categories,
    });

    if (options.json) {
      io.stdout.write(renderJson(report));
    } else if (options.quiet) {
      io.stdout.write(renderQuiet(report));
    } else {
      const color = Boolean(io.stdout.isTTY) && !process.env.NO_COLOR && !options.noColor;
      const width = Math.min(Math.max(io.stdout.columns ?? 100, 60), 140);
      io.stdout.write(renderReport(report, { color, top: options.top, showAll: options.all, width }));
    }

    return report.coverage.pass ? 0 : 1;
  } catch (error) {
    io.stderr.write(`compactaudit: ${error.message}\n`);
    return 2;
  }
}

export function parseArgs(argv) {
  const options = {
    transcript: null,
    summary: null,
    failUnder: 60,
    categories: CATEGORIES,
    top: 8,
    all: false,
    json: false,
    quiet: false,
    noColor: false,
    help: false,
    version: false,
  };

  const args = [...argv];
  if (args[0] === "audit") args.shift();

  const takeValue = (flag, inline, index) => {
    if (inline !== null) return { value: inline, next: index };
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return { value, next: index + 1 };
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-")) {
      if (options.transcript) throw new UsageError(`unexpected argument: ${arg}`);
      options.transcript = arg;
      continue;
    }

    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? null : arg.slice(equals + 1);

    switch (flag) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-v":
      case "--version":
        options.version = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--all":
        options.all = true;
        break;
      case "--no-color":
        options.noColor = true;
        break;
      case "--transcript": {
        const taken = takeValue(flag, inline, index);
        options.transcript = taken.value;
        index = taken.next;
        break;
      }
      case "--summary": {
        const taken = takeValue(flag, inline, index);
        options.summary = taken.value;
        index = taken.next;
        break;
      }
      case "--fail-under": {
        const taken = takeValue(flag, inline, index);
        options.failUnder = number(flag, taken.value, 0, 100);
        index = taken.next;
        break;
      }
      case "--top": {
        const taken = takeValue(flag, inline, index);
        options.top = number(flag, taken.value, 1, 200);
        index = taken.next;
        break;
      }
      case "--category": {
        const taken = takeValue(flag, inline, index);
        const values = taken.value
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const unknown = values.filter((value) => !CATEGORIES.includes(value));
        if (!values.length || unknown.length) {
          throw new UsageError(`--category must be a subset of ${CATEGORIES.join(",")}`);
        }
        options.categories = values;
        index = taken.next;
        break;
      }
      default:
        throw new UsageError(`unknown option: ${flag}`);
    }
  }

  return options;
}

function number(flag, value, min, max) {
  if (!/^\d+$/.test(String(value))) throw new UsageError(`${flag} must be an integer`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new UsageError(`${flag} must be between ${min} and ${max}`);
  return parsed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
