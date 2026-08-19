import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SDK_TYPES, STARTER_SUITE } from "./sdk-types";

/**
 * The declarations are hand-written inside a template literal, which means
 * nothing type-checks them the way the rest of the codebase is type-checked. A
 * stray brace would not fail the build — it would quietly leave Monaco with no
 * types at all, and the assistant with a prompt describing an API that does not
 * parse. So compile them here, along with the starter suite every new file
 * begins as.
 */

let directory: string;

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "rx-sdk-types-"));
  writeFileSync(join(directory, "rx-testing.d.ts"), SDK_TYPES, "utf8");
  writeFileSync(join(directory, "suite.ts"), STARTER_SUITE, "utf8");
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function compile(files: string[]) {
  const program = ts.createProgram(
    files.map((file) => join(directory, file)),
    {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      // The suite runs against globals and nothing else; pulling in ambient
      // @types would hide a declaration this file forgot to make.
      types: [],
    },
  );

  return [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getDeclarationDiagnostics(),
  ].map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    const file = diagnostic.file?.fileName.split("/").pop() ?? "";
    return `${file}: ${message}`;
  });
}

/** Whether a type mentions an inline object shape, at any depth. */
function containsTypeLiteral(node: ts.TypeNode): boolean {
  if (ts.isTypeLiteralNode(node)) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && ts.isTypeNode(child) && containsTypeLiteral(child)) found = true;
  });
  return found;
}

describe("the testing SDK declarations", () => {
  it("compile on their own", () => {
    expect(compile(["rx-testing.d.ts"])).toEqual([]);
  });

  it("type-check the suite every new file starts as", () => {
    // This is the exact code an author sees on first opening the editor. If it
    // does not check, the feature greets everyone with red squiggles.
    expect(compile(["rx-testing.d.ts", "suite.ts"])).toEqual([]);
  });

  it("reject a call the harness does not implement", () => {
    writeFileSync(
      join(directory, "bad.ts"),
      `suite("x", () => { test("y", async () => { await rx.nope(); }); });`,
      "utf8",
    );
    const errors = compile(["rx-testing.d.ts", "bad.ts"]);
    expect(errors.join("\n")).toContain("nope");
  });

  it("documents every part of the surface an author can call", () => {
    // JSDoc is the only documentation a suite author gets — there is no package
    // to go and read. A `//` comment is invisible to hover and completion, so
    // an undocumented member is a silent gap.
    const source = ts.createSourceFile(
      "rx-testing.d.ts",
      SDK_TYPES,
      ts.ScriptTarget.ES2020,
      true,
    );

    const undocumented: string[] = [];

    const visit = (node: ts.Node) => {
      const documentable =
        ts.isFunctionDeclaration(node) ||
        ts.isMethodSignature(node) ||
        ts.isPropertySignature(node) ||
        ts.isInterfaceDeclaration(node);

      if (documentable) {
        const name = node.name?.getText() ?? "";
        if (name && ts.getJSDocCommentsAndTags(node).length === 0) {
          undocumented.push(name);
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(source, visit);
    expect(undocumented).toEqual([]);
  });

  it("names every shape a call hands back", () => {
    // An anonymous return type cannot carry documentation and shows up in a
    // hover as a wall of braces. Naming it costs one interface and makes the
    // result something an author can follow.
    const source = ts.createSourceFile(
      "rx-testing.d.ts",
      SDK_TYPES,
      ts.ScriptTarget.ES2020,
      true,
    );

    const anonymous: string[] = [];

    const visit = (node: ts.Node) => {
      if (
        (ts.isMethodSignature(node) || ts.isFunctionDeclaration(node)) &&
        node.type &&
        containsTypeLiteral(node.type)
      ) {
        anonymous.push(node.name?.getText() ?? "<anonymous>");
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(source, visit);
    expect(anonymous).toEqual([]);
  });
});
