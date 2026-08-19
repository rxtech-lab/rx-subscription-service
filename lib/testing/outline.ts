import type { TestOutline } from "./protocol";

/**
 * Read the shape of a test file without running it.
 *
 * The editor draws a workflow diagram beside the code and needs it to update as
 * you type — before there is any run to read a shape from, and for files that
 * would not even execute. So this is a scanner over the source text rather than
 * a parser: it walks the file once, tracking brace depth outside of strings and
 * comments, and records every `suite`/`test`/`step` call whose first argument is
 * a literal string.
 *
 * The consequence is worth stating plainly: a name built at runtime
 * (`test(\`buys \${plan}\`)`) does not appear in the diagram, and a call inside a
 * loop appears once. The run itself reports the truth — `run:start` carries the
 * outline the harness actually collected — and the diagram switches to that as
 * soon as it arrives. This is the pre-run approximation, nothing more.
 */

const SUITE_CALLS = new Set(["suite", "describe"]);
const TEST_CALLS = new Set(["test", "it"]);

interface Frame {
  kind: "suite" | "test";
  index: number;
  depth: number;
}

export function parseOutline(source: string): TestOutline {
  const suites: TestOutline = [];
  const frames: Frame[] = [];
  let fallbackSuite = -1;

  const openSuite = (name: string, depth: number) => {
    suites.push({ name, tests: [] });
    frames.push({ kind: "suite", index: suites.length - 1, depth });
  };

  const currentSuite = () => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (frames[i].kind === "suite") return frames[i].index;
    }
    // A `test()` outside any `suite()` still belongs somewhere; vitest calls
    // that group the file, and so do we.
    if (fallbackSuite === -1) {
      suites.push({ name: "Tests", tests: [] });
      fallbackSuite = suites.length - 1;
    }
    return fallbackSuite;
  };

  const currentTest = () => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (frames[i].kind === "test") return frames[i];
    }
    return null;
  };

  for (const call of scanCalls(source)) {
    // Frames whose block has closed no longer contain anything.
    while (frames.length > 0 && call.depth <= frames[frames.length - 1].depth) {
      frames.pop();
    }

    if (SUITE_CALLS.has(call.callee)) {
      openSuite(call.name, call.depth);
      continue;
    }

    if (TEST_CALLS.has(call.callee)) {
      const suiteIndex = currentSuite();
      suites[suiteIndex].tests.push({ name: call.name, steps: [] });
      frames.push({
        kind: "test",
        index: suites[suiteIndex].tests.length - 1,
        depth: call.depth,
      });
      continue;
    }

    if (call.callee === "step") {
      const test = currentTest();
      if (!test) continue;
      const suiteIndex = currentSuite();
      suites[suiteIndex].tests[test.index]?.steps.push(call.name);
    }
  }

  return suites;
}

interface ScannedCall {
  callee: string;
  name: string;
  depth: number;
}

/**
 * Yield every `name("literal"` call in source order, with the brace depth it
 * sits at. Strings, template literals, comments, and regex literals are skipped
 * so a brace or the word `test` inside one cannot move the structure.
 */
function* scanCalls(source: string): Generator<ScannedCall> {
  let depth = 0;
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      i = skipTo(source, i + 2, "\n");
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(source, i);
      continue;
    }
    if (char === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      i += 1;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = i + 1;
      while (end < source.length && isIdentifierPart(source[end])) end += 1;
      const word = source.slice(i, end);

      // A property access (`rx.test(...)`) is not the global helper.
      const isMember = /[.?]\s*$/.test(source.slice(Math.max(0, i - 2), i));
      const call = isMember ? null : readStringArgument(source, end);
      if (call) yield { callee: word, name: call.value, depth };

      i = end;
      continue;
    }

    i += 1;
  }
}

/** `("literal"` immediately after an identifier, or null. */
function readStringArgument(
  source: string,
  from: number,
): { value: string } | null {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] !== "(") return null;
  i += 1;
  while (i < source.length && /\s/.test(source[i])) i += 1;

  const quote = source[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  const end = skipString(source, i);
  const raw = source.slice(i + 1, end - 1);
  // An interpolated name is not knowable statically; showing the raw
  // `${...}` would be worse than showing nothing.
  if (quote === "`" && raw.includes("${")) return null;
  return { value: unescape(raw) };
}

function skipString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

function skipTo(source: string, from: number, needle: string): number {
  const index = source.indexOf(needle, from);
  return index === -1 ? source.length : index + needle.length;
}

function unescape(raw: string): string {
  return raw
    .replaceAll("\\n", "\n")
    .replaceAll("\\'", "'")
    .replaceAll('\\"', '"')
    .replaceAll("\\`", "`")
    .replaceAll("\\\\", "\\");
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

/** Total tests across an outline — the count the diagram and the card show. */
export function countTests(outline: TestOutline): number {
  return outline.reduce((total, suite) => total + suite.tests.length, 0);
}
