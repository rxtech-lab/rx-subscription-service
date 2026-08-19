interface PinnedBottomSpacingInput {
  viewportHeight: number;
  targetScrollTop: number;
  contentHeightWithoutSpacer: number;
}

/** The exact tail space needed to make the pinned row's target scroll reachable. */
export function calculatePinnedBottomSpacing({
  viewportHeight,
  targetScrollTop,
  contentHeightWithoutSpacer,
}: PinnedBottomSpacingInput): number {
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
