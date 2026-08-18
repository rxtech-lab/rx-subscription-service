import { describe, expect, it } from "vitest";
import {
  calculatePinnedBottomSpacing,
  shouldReleasePinnedMessage,
} from "./pinned-message-layout";

describe("pinned message layout", () => {
  it("reserves only the missing space below a short user message", () => {
    expect(
      calculatePinnedBottomSpacing({
        viewportHeight: 600,
        targetScrollTop: 500,
        scrollHeight: 660,
        currentSpacerHeight: 0,
      }),
    ).toBe(440);
  });

  it("shrinks the spacer as assistant content fills the viewport", () => {
    expect(
      calculatePinnedBottomSpacing({
        viewportHeight: 600,
        targetScrollTop: 500,
        scrollHeight: 1_100,
        currentSpacerHeight: 240,
      }),
    ).toBe(240);
  });

  it("releases only after real content exists after the pinned user message", () => {
    expect(shouldReleasePinnedMessage(0, false)).toBe(false);
    expect(shouldReleasePinnedMessage(0, true)).toBe(true);
    expect(shouldReleasePinnedMessage(1, true)).toBe(false);
  });
});
