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
        contentHeightWithoutSpacer: 660,
      }),
    ).toBe(440);
  });

  it("shrinks the spacer as assistant content fills the viewport", () => {
    expect(
      calculatePinnedBottomSpacing({
        viewportHeight: 600,
        targetScrollTop: 500,
        contentHeightWithoutSpacer: 860,
      }),
    ).toBe(240);
  });

  it("uses the real content height when a short transcript does not overflow", () => {
    expect(
      calculatePinnedBottomSpacing({
        viewportHeight: 600,
        targetScrollTop: 20,
        contentHeightWithoutSpacer: 180,
      }),
    ).toBe(440);
  });

  it("releases only after real content exists after the pinned user message", () => {
    expect(shouldReleasePinnedMessage(0, false)).toBe(false);
    expect(shouldReleasePinnedMessage(0, true)).toBe(true);
    expect(shouldReleasePinnedMessage(1, true)).toBe(false);
  });
});
