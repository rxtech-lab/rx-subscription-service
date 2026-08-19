import "server-only";
import ts from "typescript";
// Type-only, so this file stays free of the database that `shared` pulls in.
import type { Actor } from "@/lib/subscription/shared";
import { SDK_TYPES } from "./sdk-types";

/**
 * Compile a suite against the SDK declarations before it is stored.
 *
 * The editor already does this — Monaco runs the same compiler over the same
 * ambient library — but the editor is not the only way source arrives here. The
 * assistant writes suites through a tool call and never sees a squiggle, so
 * without a check on this side its first sign of a mistake would be a run that
 * fails to load several seconds later, reported as a stack trace. Checking on
 * save turns that into an error message it can act on immediately.
 *
 * This is a type check, not a sandbox. It proves the suite refers to things
 * that exist and uses them with the right shapes; it says nothing about whether
 * running it is safe, which is what the sandbox is for.
 */

const SUITE_FILE = "/suite.ts";
const SDK_FILE = "/rx-testing.d.ts";

const OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  // A suite runs against globals and nothing else. Without this, ambient
  // @types packages that happen to be installed would resolve names the
  // harness does not actually provide.
  types: [],
  skipLibCheck: true,
};

export interface SuiteDiagnostic {
  /** 1-based, to match what the editor shows. */
  line: number;
  /** 1-based. */
  column: number;
  message: string;
}

/**
 * Parsed lib and SDK files, kept between calls.
 *
 * Parsing the standard library dominates the cost of a check — hundreds of
 * milliseconds against a handful for the suite itself — and it is identical
 * every time.
 */
const parsed = new Map<string, ts.SourceFile>();

function cachedSourceFile(
  fileName: string,
  read: () => string | undefined,
): ts.SourceFile | undefined {
  const hit = parsed.get(fileName);
  if (hit) return hit;

  const text = read();
  if (text === undefined) return undefined;

  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true);
  parsed.set(fileName, file);
  return file;
}

function createHost(code: string): ts.CompilerHost {
  const base = ts.createCompilerHost(OPTIONS, true);

  return {
    ...base,
    getSourceFile(fileName, languageVersion, onError, shouldCreate) {
      if (fileName === SUITE_FILE) {
        // Never cached: this is the one file that changes.
        return ts.createSourceFile(fileName, code, languageVersion, true);
      }
      if (fileName === SDK_FILE) {
        return cachedSourceFile(fileName, () => SDK_TYPES);
      }
      return cachedSourceFile(fileName, () => ts.sys.readFile(fileName)) ??
        base.getSourceFile(fileName, languageVersion, onError, shouldCreate);
    },
    fileExists(fileName) {
      if (fileName === SUITE_FILE || fileName === SDK_FILE) return true;
      return base.fileExists(fileName);
    },
    readFile(fileName) {
      if (fileName === SUITE_FILE) return code;
      if (fileName === SDK_FILE) return SDK_TYPES;
      return base.readFile(fileName);
    },
    writeFile() {},
  };
}

function position(diagnostic: ts.Diagnostic): { line: number; column: number } {
  if (!diagnostic.file || diagnostic.start === undefined) {
    return { line: 1, column: 1 };
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  return { line: line + 1, column: character + 1 };
}

/**
 * Type-check a suite. An empty array means it compiles.
 *
 * Only diagnostics from the suite itself are returned. A diagnostic from the
 * declarations would be a bug in this repo rather than in the author's code, so
 * it is logged instead of being blamed on whoever pressed save —
 * `sdk-types.test.ts` is what keeps that from happening.
 */
export function checkSuiteTypes(code: string): SuiteDiagnostic[] {
  const program = ts.createProgram({
    rootNames: [SDK_FILE, SUITE_FILE],
    options: OPTIONS,
    host: createHost(code),
  });

  const suite = program.getSourceFile(SUITE_FILE);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(suite),
    ...program.getSemanticDiagnostics(suite),
  ];

  const sdkProblems = program
    .getSemanticDiagnostics(program.getSourceFile(SDK_FILE))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  if (sdkProblems.length > 0) {
    console.error("The testing SDK declarations do not compile:", sdkProblems);
  }

  return diagnostics.map((diagnostic) => ({
    ...position(diagnostic),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  }));
}

/** One line per diagnostic, for an error message or a tool result. */
export function formatSuiteDiagnostics(diagnostics: SuiteDiagnostic[]): string {
  return diagnostics
    .map((entry) => `line ${entry.line}:${entry.column} — ${entry.message}`)
    .join("\n");
}

/**
 * Check a suite on the way in, and refuse a write whose author cannot see it is
 * broken.
 *
 * The asymmetry is deliberate. A human editing in the console already has the
 * errors in front of them — Monaco runs the same compiler live — so blocking
 * the save would only stop them parking a half-finished thought; they get the
 * diagnostics back as a warning instead. The assistant sees nothing until
 * something fails, so for it a broken suite is refused outright and the
 * diagnostics become the tool result it retries from.
 *
 * @throws a ValidationError, which the tool executor turns into that result.
 */
export function enforceSuiteTypes(code: string, actor: Actor): SuiteDiagnostic[] {
  const diagnostics = checkSuiteTypes(code);
  if (diagnostics.length > 0 && actor.type === "ai") {
    const error = new Error(
      `The suite does not compile. Fix these errors and retry the write:\n${formatSuiteDiagnostics(
        diagnostics,
      )}`,
    );
    // Matched by name rather than by class so this module does not have to
    // import the service layer that defines it.
    error.name = "ValidationError";
    throw error;
  }
  return diagnostics;
}
