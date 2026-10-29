import { Resvg } from "@resvg/resvg-js";
import type { ExcalidrawElement } from "./elements";

// Plain-SVG renderer for the MCP `render_drawing` tool: lets Claude look at a
// drawing and judge layout. It is a faithful but simplified view (clean strokes
// instead of Excalidraw's hand-drawn style, hatch fills drawn as solid), not an
// export format, so it is never written back to the drawing.

const esc = (value: unknown): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const FONT_STACK: Record<number, string> = {
  3: "DejaVu Sans Mono, monospace",
};
const fontFor = (family: unknown): string =>
  FONT_STACK[Number(family)] ?? "Helvetica, Arial, DejaVu Sans, sans-serif";

const paint = (color: unknown): string =>
  typeof color === "string" && color && color !== "transparent"
    ? color
    : "none";

const dash = (el: ExcalidrawElement): string => {
  const w = el.strokeWidth ?? 2;
  if (el.strokeStyle === "dashed")
    return ` stroke-dasharray="${w * 4} ${w * 3}"`;
  if (el.strokeStyle === "dotted") return ` stroke-dasharray="${w} ${w * 2.5}"`;
  return "";
};

const strokeAttrs = (el: ExcalidrawElement): string =>
  `stroke="${esc(paint(el.strokeColor))}" stroke-width="${el.strokeWidth ?? 2}"${dash(el)} stroke-linecap="round" stroke-linejoin="round"`;

const arrowhead = (
  kind: string | null | undefined,
  tip: [number, number],
  from: [number, number],
  el: ExcalidrawElement,
): string => {
  if (!kind) return "";
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const size = 12 + (el.strokeWidth ?? 2) * 2;
  const spread = Math.PI / 7;
  const a = [
    tip[0] - size * Math.cos(angle - spread),
    tip[1] - size * Math.sin(angle - spread),
  ];
  const b = [
    tip[0] - size * Math.cos(angle + spread),
    tip[1] - size * Math.sin(angle + spread),
  ];
  const filled = kind === "triangle" || kind === "dot" || kind === "circle";
  return `<path d="M ${a[0]} ${a[1]} L ${tip[0]} ${tip[1]} L ${b[0]} ${b[1]}${filled ? " Z" : ""}" fill="${filled ? esc(paint(el.strokeColor)) : "none"}" ${strokeAttrs(el).replace(/ stroke-dasharray="[^"]*"/, "")}/>`;
};

const renderElement = (
  el: ExcalidrawElement,
  files: Record<string, any>,
): string => {
  const w = el.width ?? 0;
  const h = el.height ?? 0;
  const fill = esc(paint(el.backgroundColor));
  const common = `fill="${fill}" ${strokeAttrs(el)}`;
  switch (el.type) {
    case "rectangle": {
      const r = el.roundness ? Math.min(w, h) * 0.12 : 0;
      return `<rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ${common}/>`;
    }
    case "ellipse":
      return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${common}/>`;
    case "diamond":
      return `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" ${common}/>`;
    case "line":
    case "arrow": {
      const pts: [number, number][] = el.points ?? [];
      if (pts.length < 2) return "";
      const path = pts
        .map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`)
        .join(" ");
      let out = `<path d="${path}" fill="none" ${strokeAttrs(el)}/>`;
      if (el.type === "arrow") {
        const n = pts.length;
        out += arrowhead(el.endArrowhead, pts[n - 1], pts[n - 2], el);
        out += arrowhead(el.startArrowhead, pts[0], pts[1], el);
      }
      return out;
    }
    case "freedraw": {
      const pts: [number, number][] = el.points ?? [];
      if (!pts.length) return "";
      const path = pts
        .map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`)
        .join(" ");
      return `<path d="${path}" fill="none" ${strokeAttrs(el)}/>`;
    }
    case "text": {
      const size = el.fontSize ?? 20;
      const lineHeight = (el.lineHeight ?? 1.25) * size;
      const align = el.textAlign ?? "left";
      const anchor =
        align === "center" ? "middle" : align === "right" ? "end" : "start";
      const x = align === "center" ? w / 2 : align === "right" ? w : 0;
      const lines = String(el.text ?? "").split("\n");
      const spans = lines
        .map(
          (line, i) =>
            `<tspan x="${x}" y="${(i + 0.8) * lineHeight}">${esc(line) || " "}</tspan>`,
        )
        .join("");
      return `<text font-family="${esc(fontFor(el.fontFamily))}" font-size="${size}" text-anchor="${anchor}" fill="${esc(paint(el.strokeColor))}" xml:space="preserve">${spans}</text>`;
    }
    case "image": {
      const file = files?.[el.fileId];
      const url = file?.dataURL;
      if (typeof url !== "string" || !url.startsWith("data:image/"))
        return `<rect width="${w}" height="${h}" fill="#f1f3f5" stroke="#adb5bd" stroke-dasharray="6 4"/>`;
      return `<image href="${esc(url)}" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
    }
    default:
      return "";
  }
};

const bounds = (elements: ExcalidrawElement[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const pad = (el.strokeWidth ?? 2) + (el.type === "arrow" ? 14 : 0);
    const xs: number[] = [el.x, el.x + el.width];
    const ys: number[] = [el.y, el.y + el.height];
    for (const [px, py] of el.points ?? []) {
      xs.push(el.x + px);
      ys.push(el.y + py);
    }
    minX = Math.min(minX, ...xs) - pad;
    maxX = Math.max(maxX, ...xs) + pad;
    minY = Math.min(minY, ...ys) - pad;
    maxY = Math.max(maxY, ...ys) + pad;
  }
  return { minX, minY, maxX, maxY };
};

export const elementsToSvg = (
  allElements: ExcalidrawElement[],
  files: Record<string, any> = {},
  background = "#ffffff",
): { svg: string; width: number; height: number } => {
  const elements = allElements.filter((e) => !e.isDeleted);
  if (elements.length === 0)
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="${esc(background)}"/><text x="200" y="105" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#868e96">Empty drawing</text></svg>`,
      width: 400,
      height: 200,
    };
  const b = bounds(elements);
  const margin = 24;
  const width = Math.ceil(b.maxX - b.minX + margin * 2);
  const height = Math.ceil(b.maxY - b.minY + margin * 2);
  const ox = margin - b.minX;
  const oy = margin - b.minY;
  const arrowIds = new Set(
    elements.filter((e) => e.type === "arrow").map((e) => e.id),
  );
  const body = elements
    .map((el) => {
      let inner = renderElement(el, files);
      // Arrow labels sit on a background patch so the line doesn't strike them out.
      if (inner && el.type === "text" && arrowIds.has(el.containerId)) {
        inner = `<rect x="-3" y="0" width="${el.width + 6}" height="${el.height}" fill="${esc(background)}"/>${inner}`;
      }
      if (!inner) return "";
      const rotate = el.angle
        ? ` rotate(${(el.angle * 180) / Math.PI} ${el.width / 2} ${el.height / 2})`
        : "";
      const opacity =
        el.opacity !== undefined && el.opacity < 100
          ? ` opacity="${el.opacity / 100}"`
          : "";
      return `<g transform="translate(${el.x + ox} ${el.y + oy})${rotate}"${opacity}>${inner}</g>`;
    })
    .join("");
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${esc(background)}"/>${body}</svg>`,
    width,
    height,
  };
};

export const renderPng = (
  elements: ExcalidrawElement[],
  files: Record<string, any> = {},
  options: { maxWidth?: number; background?: string } = {},
): Buffer => {
  const { svg, width } = elementsToSvg(elements, files, options.background);
  const maxWidth = options.maxWidth ?? 1200;
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.min(Math.max(width, 400), maxWidth) },
    font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
  });
  return resvg.render().asPng();
};
