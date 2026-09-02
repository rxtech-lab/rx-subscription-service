export const DEFAULT_EDITOR_PANEL_WIDTH = 352;
export const MIN_EDITOR_PANEL_WIDTH = 280;
/** The layers column plus enough canvas to still see a whole phone. */
const EDITOR_RESERVED_WIDTH = 256 + 460;

/** Keep the dragged inspector width usable on a laptop and on a wide display. */
export function clampEditorPanelWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_EDITOR_PANEL_WIDTH;
  const maximum = Math.max(MIN_EDITOR_PANEL_WIDTH, viewportWidth - EDITOR_RESERVED_WIDTH);
  return Math.round(Math.min(maximum, Math.max(MIN_EDITOR_PANEL_WIDTH, width)));
}
