import { describe, expect, it } from "vitest";
import {
  clampEditorPanelWidth,
  DEFAULT_EDITOR_PANEL_WIDTH,
  MIN_EDITOR_PANEL_WIDTH,
} from "./panel-width";

describe("clampEditorPanelWidth", () => {
  it("falls back to the default for a garbage stored value", () => {
    expect(clampEditorPanelWidth(Number.NaN, 1600)).toBe(DEFAULT_EDITOR_PANEL_WIDTH);
  });

  it("never goes below the minimum", () => {
    expect(clampEditorPanelWidth(100, 1600)).toBe(MIN_EDITOR_PANEL_WIDTH);
  });

  it("leaves room for the layers column and the phone", () => {
    expect(clampEditorPanelWidth(1400, 1600)).toBe(1600 - 716);
  });

  it("keeps the minimum on a very narrow viewport", () => {
    expect(clampEditorPanelWidth(500, 800)).toBe(MIN_EDITOR_PANEL_WIDTH);
  });

  it("rounds to whole pixels", () => {
    expect(clampEditorPanelWidth(400.6, 1600)).toBe(401);
  });
});
