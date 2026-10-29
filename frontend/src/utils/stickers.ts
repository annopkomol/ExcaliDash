/**
 * Miro-style stickers: bundled Twemoji SVGs (CC-BY 4.0, see
 * assets/stickers/LICENSE.md) inserted as plain Excalidraw image elements. The
 * SVG travels in the scene's `files` as a dataURL, exactly like an image the
 * user dropped in, so copy-paste into excalidraw.com keeps working.
 */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

export const STICKER_SIZE = 120;

const modules = import.meta.glob("../assets/stickers/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface Sticker {
  name: string;
  svg: string;
}

export const STICKERS: Sticker[] = Object.entries(modules).map(
  ([path, svg]) => ({
    name: path.split("/").pop()!.replace(/\.svg$/, ""),
    svg,
  }),
);

export const stickerDataUrl = (svg: string) =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

const sha1Hex = async (text: string) => {
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const buildSticker = async (
  sticker: Sticker,
  center: { x: number; y: number },
) => {
  const dataURL = stickerDataUrl(sticker.svg);
  const fileId = await sha1Hex(dataURL);
  const [element] = convertToExcalidrawElements([
    {
      type: "image",
      fileId: fileId as any,
      status: "saved",
      x: center.x - STICKER_SIZE / 2,
      y: center.y - STICKER_SIZE / 2,
      width: STICKER_SIZE,
      height: STICKER_SIZE,
    } as any,
  ]);
  const file = {
    id: fileId,
    dataURL,
    mimeType: "image/svg+xml",
    created: Date.now(),
  };
  return { element, file };
};
