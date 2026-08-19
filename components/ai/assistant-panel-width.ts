export const DEFAULT_ASSISTANT_PANEL_WIDTH = 420;
export const MIN_ASSISTANT_PANEL_WIDTH = 320;
/** Reserve room for the navigation column and a useful page-content column. */
const WORKSPACE_RESERVED_WIDTH = 720;

/** Keep the dragged width usable on both narrow laptops and wide displays. */
export function clampAssistantPanelWidth(
  width: number,
  viewportWidth: number,
): number {
  if (!Number.isFinite(width)) return DEFAULT_ASSISTANT_PANEL_WIDTH;

  const maximum = Math.max(
    MIN_ASSISTANT_PANEL_WIDTH,
    viewportWidth - WORKSPACE_RESERVED_WIDTH,
  );
  return Math.round(
    Math.min(maximum, Math.max(MIN_ASSISTANT_PANEL_WIDTH, width)),
  );
}
