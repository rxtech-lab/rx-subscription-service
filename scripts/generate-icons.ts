/**
 * Render the brand mark in `lib/brand.ts` into the icon files Next.js serves
 * from `app/`: `icon.svg` (modern browsers), `favicon.ico` (legacy and direct
 * `/favicon.ico` hits), and `apple-icon.png` (iOS home screen).
 *
 * Re-run after editing `lib/brand.ts` and commit the output — the build does
 * not regenerate these.
 *
 *   bun run scripts/generate-icons.ts
 *
 * `sharp` comes in with Next.js rather than as a direct dependency; it is only
 * needed here, never at request time.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { BRAND_MARK_SVG } from "../lib/brand";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const ICO_SIZES = [16, 32, 48];
const APPLE_ICON_SIZE = 180;

const render = (size: number) =>
  sharp(Buffer.from(BRAND_MARK_SVG)).resize(size, size).png().toBuffer();

/**
 * A minimal ICO container: a 6-byte header, one 16-byte directory entry per
 * size, then the PNG payloads. Every browser that still asks for `.ico`
 * understands PNG-in-ICO, so there is no BMP encoding to do.
 */
function buildIco(images: { size: number; png: Buffer }[]) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colours
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const icoImages = await Promise.all(
  ICO_SIZES.map(async (size) => ({ size, png: await render(size) })),
);

await writeFile(join(APP_DIR, "icon.svg"), BRAND_MARK_SVG);
await writeFile(join(APP_DIR, "favicon.ico"), buildIco(icoImages));
await writeFile(join(APP_DIR, "apple-icon.png"), await render(APPLE_ICON_SIZE));

console.log(
  `Wrote app/icon.svg, app/favicon.ico (${ICO_SIZES.join(", ")}px), and app/apple-icon.png (${APPLE_ICON_SIZE}px)`,
);
