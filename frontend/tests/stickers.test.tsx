import { describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (els: any[]) => els,
}));

import { STICKERS, STICKER_SIZE, buildSticker } from "../src/utils/stickers";

describe("stickers", () => {
  it("bundles svg stickers", () => {
    expect(STICKERS.length).toBeGreaterThan(20);
    for (const s of STICKERS) expect(s.svg).toContain("<svg");
  });

  it("builds a plain image element with an embedded dataURL file", async () => {
    const { element, file } = await buildSticker(STICKERS[0], { x: 0, y: 0 });
    expect(element.type).toBe("image");
    expect((element as any).fileId).toBe(file.id);
    expect(element.width).toBe(STICKER_SIZE);
    expect(file.mimeType).toBe("image/svg+xml");
    expect(file.dataURL.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect((element as any).customData).toBeUndefined();
  });
});
