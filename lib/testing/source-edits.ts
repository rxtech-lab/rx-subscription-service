export type SuiteSourceEdit =
  | {
      type: "replace";
      oldCode: string;
      newCode: string;
      all?: boolean;
    }
  | {
      type: "replace_lines";
      startLine: number;
      endLine: number;
      code: string;
    }
  | {
      type: "insert_after";
      line: number;
      code: string;
    }
  | {
      type: "insert_before";
      line: number;
      code: string;
    }
  | {
      type: "delete_lines";
      startLine: number;
      endLine: number;
    }
  | {
      type: "append";
      code: string;
    };

export class SuiteSourceEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuiteSourceEditError";
  }
}

function assertLine(line: number, lineCount: number, label = "line") {
  if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) {
    throw new SuiteSourceEditError(
      `${label} ${line} is outside the current 1-${lineCount} line range`,
    );
  }
}

function assertRange(startLine: number, endLine: number, lineCount: number) {
  assertLine(startLine, lineCount, "startLine");
  assertLine(endLine, lineCount, "endLine");
  if (startLine > endLine) {
    throw new SuiteSourceEditError("startLine must be before or equal to endLine");
  }
}

/**
 * Apply source edits in order. Line numbers are 1-based and each line-based
 * edit addresses the source produced by all preceding edits in the same call.
 */
export function applySuiteSourceEdits(
  source: string,
  edits: readonly SuiteSourceEdit[],
): string {
  if (edits.length === 0) {
    throw new SuiteSourceEditError("at least one source edit is required");
  }

  let result = source;
  for (const edit of edits) {
    if (edit.type === "replace") {
      if (!edit.oldCode) {
        throw new SuiteSourceEditError("replace.oldCode cannot be empty");
      }
      const first = result.indexOf(edit.oldCode);
      if (first === -1) {
        throw new SuiteSourceEditError(
          "replace.oldCode was not found in the current suite source",
        );
      }
      if (edit.all) {
        result = result.split(edit.oldCode).join(edit.newCode);
        continue;
      }
      if (result.indexOf(edit.oldCode, first + edit.oldCode.length) !== -1) {
        throw new SuiteSourceEditError(
          "replace.oldCode matches more than once; make it more specific or set all to true",
        );
      }
      result =
        result.slice(0, first) +
        edit.newCode +
        result.slice(first + edit.oldCode.length);
      continue;
    }

    if (edit.type === "append") {
      result += `${result.endsWith("\n") ? "" : "\n"}${edit.code}`;
      continue;
    }

    const lines = result.split("\n");
    if (edit.type === "insert_after" || edit.type === "insert_before") {
      assertLine(edit.line, lines.length);
      const index = edit.type === "insert_after" ? edit.line : edit.line - 1;
      lines.splice(index, 0, ...edit.code.split("\n"));
      result = lines.join("\n");
      continue;
    }

    assertRange(edit.startLine, edit.endLine, lines.length);
    const deleteCount = edit.endLine - edit.startLine + 1;
    if (edit.type === "replace_lines") {
      lines.splice(edit.startLine - 1, deleteCount, ...edit.code.split("\n"));
    } else {
      lines.splice(edit.startLine - 1, deleteCount);
    }
    result = lines.join("\n");
  }

  return result;
}
