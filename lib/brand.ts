/**
 * Single source of truth for the RxLab mark — the same gradient square and
 * `lucide` layers glyph that `components/console/brand-mark.tsx` renders in the
 * console header.
 *
 * `scripts/generate-icons.ts` writes `app/icon.svg`, `app/favicon.ico`, and
 * `app/apple-icon.png` from this string; `app/opengraph-image.tsx` embeds it as
 * a data URI because satori cannot render React icon components.
 */

/** Layer paths from `lucide-react`'s `layers` icon (ISC), on a 24×24 grid. */
const LAYERS_PATHS = [
  "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
  "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
  "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
];

export const BRAND_GRADIENT = {
  from: "#2563eb",
  via: "#0ea5e9",
  to: "#22d3ee",
} as const;

/**
 * The mark on a 512×512 canvas. The glyph is scaled to 60% of the tile (vs the
 * header's 50%) and carries a heavier stroke so it still reads at 16px.
 */
export const BRAND_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="RxLab">
  <defs>
    <linearGradient id="rxlab-mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND_GRADIENT.from}"/>
      <stop offset="55%" stop-color="${BRAND_GRADIENT.via}"/>
      <stop offset="100%" stop-color="${BRAND_GRADIENT.to}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#rxlab-mark)"/>
  <g transform="translate(102 102) scale(12.833)" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
${LAYERS_PATHS.map((d) => `    <path d="${d}"/>`).join("\n")}
  </g>
</svg>
`;

/** Percent-encoded rather than base64 so this stays free of `Buffer`. */
export const BRAND_MARK_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  BRAND_MARK_SVG,
)}`;
