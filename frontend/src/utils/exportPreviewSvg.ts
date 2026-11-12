/**
 * Light-theme SVG export used for drawing previews/thumbnails.
 * Wraps Excalidraw's `exportScene`, translating the old `exportToSvg`
 * appState flags (`exportBackground`, `viewBackgroundColor`) into config.
 */
export const exportPreviewSvg = async ({
  elements,
  files,
  viewBackgroundColor,
  exportBackground,
}: {
  elements: readonly any[];
  files?: Record<string, any> | null;
  viewBackgroundColor: string;
  exportBackground: boolean;
}): Promise<SVGSVGElement> => {
  const { exportScene } = await import("@excalidraw/excalidraw");
  return exportScene({
    type: "svg",
    // exportScene expects non-deleted elements (exportToSvg filtered for us).
    data: {
      elements: elements.filter((el) => !el.isDeleted) as any,
      files: files ?? {},
    },
    config: {
      theme: "light",
      padding: 10,
      canvasBackgroundColor: exportBackground ? viewBackgroundColor : false,
    },
  });
};
