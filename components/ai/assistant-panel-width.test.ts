import { describe, expect, it } from "vitest";
import {
  clampAssistantPanelWidth,
  DEFAULT_ASSISTANT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
} from "./assistant-panel-width";

describe("clampAssistantPanelWidth", () => {
  it("keeps a width that fits the viewport", () => {
    expect(clampAssistantPanelWidth(640, 1440)).toBe(640);
  });

  it("never drops below the minimum", () => {
    expect(clampAssistantPanelWidth(120, 1440)).toBe(MIN_ASSISTANT_PANEL_WIDTH);
  });

  it("leaves room for navigation and useful page content on wide drags", () => {
    expect(clampAssistantPanelWidth(1400, 1440)).toBe(720);
  });

  it("allows a wider agent column when the workspace has room", () => {
    expect(clampAssistantPanelWidth(1400, 1920)).toBe(1200);
  });

  it("prefers the minimum when the viewport is smaller than it", () => {
    expect(clampAssistantPanelWidth(600, 360)).toBe(MIN_ASSISTANT_PANEL_WIDTH);
  });

  it("falls back to the default for an unusable stored width", () => {
    expect(clampAssistantPanelWidth(Number.NaN, 1440)).toBe(
      DEFAULT_ASSISTANT_PANEL_WIDTH,
    );
  });
});
