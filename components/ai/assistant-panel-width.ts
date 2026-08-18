export const DEFAULT_ASSISTANT_PANEL_WIDTH = 420;
export const MIN_ASSISTANT_PANEL_WIDTH = 320;
/** Leave enough of the page visible that the panel never covers the app. */
const VIEWPORT_MARGIN = 96;

/** Keep the dragged width usable on both narrow laptops and wide displays. */
export function clampAssistantPanelWidth(
  width: number,
  viewportWidth: number,
): number {
  if (!Number.isFinite(width)) return DEFAULT_ASSISTANT_PANEL_WIDTH;

  const maximum = Math.max(
    MIN_ASSISTANT_PANEL_WIDTH,
    viewportWidth - VIEWPORT_MARGIN,
  );
  return Math.round(
    Math.min(maximum, Math.max(MIN_ASSISTANT_PANEL_WIDTH, width)),
  );
}
