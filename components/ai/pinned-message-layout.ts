interface PinnedBottomSpacingInput {
  viewportHeight: number;
  targetScrollTop: number;
  scrollHeight: number;
  currentSpacerHeight: number;
}

/** The exact tail space needed to make the pinned row's target scroll reachable. */
export function calculatePinnedBottomSpacing({
  viewportHeight,
  targetScrollTop,
  scrollHeight,
  currentSpacerHeight,
}: PinnedBottomSpacingInput): number {
  const contentHeightWithoutSpacer = scrollHeight - currentSpacerHeight;
  return Math.max(
    0,
    Math.ceil(targetScrollTop + viewportHeight - contentHeightWithoutSpacer),
  );
}

/** Never release a pin just because the user's own message is viewport-height. */
export function shouldReleasePinnedMessage(
  bottomSpacing: number,
  hasContentAfterPinnedMessage: boolean,
): boolean {
  return bottomSpacing === 0 && hasContentAfterPinnedMessage;
}
