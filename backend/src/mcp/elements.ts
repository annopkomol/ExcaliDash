import crypto from "crypto";

// Turns the compact element descriptions Claude writes ("skeletons") into
// complete, standard Excalidraw v2 elements, so a scene saved through MCP
// copy-pastes into excalidraw.com unchanged: no custom fields, only the
// documented element shape (bound text via containerId/boundElements, arrows
// via startBinding/endBinding).

export type ExcalidrawElement = Record<string, any> & {
  id: string;
  type: string;
};

export type Skeleton = {
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line";
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  label?: { text: string; fontSize?: number; strokeColor?: string };
  fontSize?: number;
  textAlign?: "left" | "center" | "right";
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: "solid" | "hachure" | "cross-hatch" | "zigzag";
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  roughness?: number;
  opacity?: number;
  rounded?: boolean;
  from?: string;
  to?: string;
  points?: [number, number][];
  startArrowhead?: string | null;
  endArrowhead?: string | null;
};

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const HELVETICA = 2;
const LINE_HEIGHT = 1.15;
const PADDING = 12;

const randomInt = () => crypto.randomInt(1, 2 ** 31 - 1);
const newId = () => crypto.randomBytes(12).toString("base64url");

const charWidth = (ch: string, fontSize: number): number => {
  const code = ch.codePointAt(0) ?? 0;
  // CJK, Thai-adjacent and other wide scripts are roughly square; Latin ~0.56em.
  if (code >= 0x2e80)
    return fontSize * (code >= 0x0e00 && code <= 0x0e7f ? 0.6 : 1);
  if (code >= 0x0e00 && code <= 0x0e7f) return fontSize * 0.6;
  return fontSize * 0.56;
};

export const measureText = (text: string, fontSize: number) => {
  const lines = text.split("\n");
  const width = Math.max(
    ...lines.map((line) =>
      Array.from(line).reduce((sum, ch) => sum + charWidth(ch, fontSize), 0),
    ),
    fontSize,
  );
  return {
    width: Math.ceil(width),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
};

const wrapText = (text: string, fontSize: number, maxWidth: number): string =>
  text
    .split("\n")
    .map((paragraph) => {
      const words = paragraph.split(" ");
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && measureText(candidate, fontSize).width > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
      return lines.join("\n");
    })
    .join("\n");

const baseElement = (
  type: string,
  id: string,
  s: Partial<Skeleton>,
  extra: Record<string, unknown>,
): ExcalidrawElement => ({
  id,
  type,
  x: s.x ?? 0,
  y: s.y ?? 0,
  width: s.width ?? 0,
  height: s.height ?? 0,
  angle: 0,
  strokeColor: s.strokeColor ?? "#1e1e1e",
  backgroundColor: s.backgroundColor ?? "transparent",
  fillStyle: s.fillStyle ?? "solid",
  strokeWidth: s.strokeWidth ?? 2,
  strokeStyle: s.strokeStyle ?? "solid",
  roughness: s.roughness ?? 1,
  opacity: s.opacity ?? 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: randomInt(),
  version: 1,
  versionNonce: randomInt(),
  isDeleted: false,
  boundElements: null,
  updated: Date.now(),
  link: null,
  locked: false,
  index: null,
  ...extra,
});

const makeText = (
  id: string,
  text: string,
  x: number,
  y: number,
  opts: {
    fontSize?: number;
    textAlign?: string;
    strokeColor?: string;
    containerId?: string | null;
    verticalAlign?: string;
    wrapWidth?: number;
  },
): ExcalidrawElement => {
  const fontSize = opts.fontSize ?? 20;
  const wrapped =
    opts.wrapWidth !== undefined
      ? wrapText(text, fontSize, opts.wrapWidth)
      : text;
  const size = measureText(wrapped, fontSize);
  return baseElement(
    "text",
    id,
    {
      x,
      y,
      width: size.width,
      height: size.height,
      strokeColor: opts.strokeColor,
    },
    {
      roughness: 1,
      strokeWidth: 1,
      text: wrapped,
      originalText: text,
      fontSize,
      fontFamily: HELVETICA,
      textAlign: opts.textAlign ?? "left",
      verticalAlign: opts.verticalAlign ?? "top",
      containerId: opts.containerId ?? null,
      autoResize: true,
      lineHeight: LINE_HEIGHT,
    },
  );
};

// Point where the segment from the shape's centre towards (tx, ty) leaves it.
const edgePoint = (
  shape: ExcalidrawElement,
  tx: number,
  ty: number,
): [number, number] => {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = shape.width / 2 || 1;
  const hh = shape.height / 2 || 1;
  let t: number;
  if (shape.type === "ellipse") {
    t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  } else if (shape.type === "diamond") {
    t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else {
    t = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  }
  return [cx + dx * t, cy + dy * t];
};

const addBound = (el: ExcalidrawElement, ref: { id: string; type: string }) => {
  el.boundElements = [...(el.boundElements ?? []), ref];
};

const touch = (el: ExcalidrawElement) => {
  el.version = (el.version ?? 1) + 1;
  el.versionNonce = randomInt();
  el.updated = Date.now();
};

export type BuildResult = {
  created: ExcalidrawElement[];
  // Pre-existing elements whose boundElements changed (arrows attached to them).
  modified: ExcalidrawElement[];
};

export const buildElements = (
  skeletons: Skeleton[],
  existing: ExcalidrawElement[] = [],
): BuildResult => {
  const created: ExcalidrawElement[] = [];
  const modified = new Map<string, ExcalidrawElement>();
  const byId = new Map<string, ExcalidrawElement>();
  for (const el of existing) byId.set(el.id, el);

  const claimId = (wanted?: string): string => {
    if (wanted) {
      if (byId.has(wanted))
        throw new Error(`Element id already exists: ${wanted}`);
      return wanted;
    }
    let id = newId();
    while (byId.has(id)) id = newId();
    return id;
  };
  const register = (el: ExcalidrawElement) => {
    byId.set(el.id, el);
    created.push(el);
  };
  const lookup = (id: string, role: string): ExcalidrawElement => {
    const el = byId.get(id);
    if (!el || el.isDeleted)
      throw new Error(`Arrow ${role} references unknown element id: ${id}`);
    if (!SHAPES.has(el.type) && el.type !== "text" && el.type !== "image")
      throw new Error(`Arrow ${role} must reference a shape, got ${el.type}`);
    return el;
  };
  const markModified = (el: ExcalidrawElement) => {
    if (created.includes(el)) return;
    touch(el);
    modified.set(el.id, el);
  };

  // Pass 1: shapes and text (so arrows can reference them, in any order).
  for (const s of skeletons) {
    if (s.type === "arrow" || s.type === "line") continue;
    const id = claimId(s.id);
    if (s.type === "text") {
      if (!s.text) throw new Error("text elements need a `text` value");
      register(
        makeText(id, s.text, s.x ?? 0, s.y ?? 0, {
          fontSize: s.fontSize,
          textAlign: s.textAlign,
          strokeColor: s.strokeColor,
        }),
      );
      continue;
    }
    if (!SHAPES.has(s.type))
      throw new Error(`Unsupported element type: ${s.type}`);
    const fontSize = s.label?.fontSize ?? s.fontSize ?? 20;
    let width = s.width;
    let height = s.height;
    if (s.label && (width === undefined || height === undefined)) {
      const size = measureText(s.label.text, fontSize);
      width ??= size.width + PADDING * 4;
      height ??= size.height + PADDING * 2;
    }
    const shape = baseElement(
      s.type,
      id,
      { ...s, width: width ?? 100, height: height ?? 100 },
      {
        roundness:
          s.type === "diamond" || s.rounded === false
            ? null
            : s.type === "rectangle" && s.rounded === undefined
              ? { type: 3 }
              : s.rounded
                ? { type: 3 }
                : null,
      },
    );
    register(shape);
    if (s.label) {
      const textId = claimId();
      const text = makeText(textId, s.label.text, 0, 0, {
        fontSize,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: id,
        strokeColor: s.label.strokeColor,
        wrapWidth: shape.width - PADDING * 2,
      });
      // Wrapped text taller than the box: grow the box instead of overflowing.
      if (text.height + PADDING * 2 > shape.height) {
        shape.height = text.height + PADDING * 2;
      }
      text.x = shape.x + (shape.width - text.width) / 2;
      text.y = shape.y + (shape.height - text.height) / 2;
      addBound(shape, { id: textId, type: "text" });
      register(text);
    }
  }

  // Pass 2: arrows and lines.
  for (const s of skeletons) {
    if (s.type !== "arrow" && s.type !== "line") continue;
    const id = claimId(s.id);
    let points: [number, number][];
    let x = s.x ?? 0;
    let y = s.y ?? 0;
    let start: ExcalidrawElement | undefined;
    let end: ExcalidrawElement | undefined;
    if (s.from || s.to) {
      if (s.type !== "arrow")
        throw new Error("`from`/`to` are only valid on arrows");
      start = s.from ? lookup(s.from, "from") : undefined;
      end = s.to ? lookup(s.to, "to") : undefined;
      const sc: [number, number] = start
        ? [start.x + start.width / 2, start.y + start.height / 2]
        : [s.x ?? 0, s.y ?? 0];
      const ec: [number, number] = end
        ? [end.x + end.width / 2, end.y + end.height / 2]
        : [(s.x ?? 0) + (s.width ?? 100), (s.y ?? 0) + (s.height ?? 0)];
      const p0 = start ? edgePoint(start, ec[0], ec[1]) : sc;
      const p1 = end ? edgePoint(end, sc[0], sc[1]) : ec;
      x = p0[0];
      y = p0[1];
      points = [
        [0, 0],
        [p1[0] - p0[0], p1[1] - p0[1]],
      ];
    } else if (s.points && s.points.length >= 2) {
      // Points are given absolute-free: relative to (x, y), first point forced to 0,0.
      const [fx, fy] = s.points[0];
      points = s.points.map(([px, py]) => [px - fx, py - fy]);
    } else {
      points = [
        [0, 0],
        [s.width ?? 100, s.height ?? 0],
      ];
    }
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const arrow = baseElement(
      s.type,
      id,
      {
        ...s,
        x,
        y,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
      {
        points,
        lastCommittedPoint: null,
        startBinding: start ? { elementId: start.id, focus: 0, gap: 1 } : null,
        endBinding: end ? { elementId: end.id, focus: 0, gap: 1 } : null,
        startArrowhead: s.type === "arrow" ? (s.startArrowhead ?? null) : null,
        endArrowhead:
          s.type === "arrow"
            ? s.endArrowhead === undefined
              ? "arrow"
              : s.endArrowhead
            : null,
        roundness: { type: 2 },
        ...(s.type === "arrow" ? { elbowed: false } : {}),
      },
    );
    register(arrow);
    for (const shape of [start, end]) {
      if (!shape) continue;
      markModified(shape);
      addBound(shape, { id, type: "arrow" });
    }
    if (s.label) {
      const textId = claimId();
      const text = makeText(textId, s.label.text, 0, 0, {
        fontSize: s.label.fontSize ?? 16,
        textAlign: "center",
        verticalAlign: "middle",
        containerId: id,
        strokeColor: s.label.strokeColor,
      });
      const mid = points[points.length - 1];
      text.x = x + mid[0] / 2 - text.width / 2;
      text.y = y + mid[1] / 2 - text.height / 2;
      addBound(arrow, { id: textId, type: "text" });
      register(text);
    }
  }

  return { created, modified: [...modified.values()] };
};

// Fields Claude may patch on an existing element; everything else stays put so
// a patch can't corrupt structural fields (id, type, bindings, points).
const PATCHABLE = new Set([
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "text",
  "fontSize",
  "textAlign",
  "locked",
  "link",
]);

export const patchElement = (
  el: ExcalidrawElement,
  patch: Record<string, unknown>,
  all: ExcalidrawElement[],
): ExcalidrawElement[] => {
  const touched: ExcalidrawElement[] = [el];
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCHABLE.has(key)) throw new Error(`Field not patchable: ${key}`);
    if (key === "text" && el.type !== "text") {
      // Changing the label of a shape/arrow edits its bound text.
      const bound = all.find(
        (e) => e.type === "text" && e.containerId === el.id && !e.isDeleted,
      );
      if (!bound) throw new Error(`Element ${el.id} has no label to change`);
      applyText(bound, String(value), el);
      touched.push(bound);
      continue;
    }
    el[key] = value;
    if (key === "text" && el.type === "text") applyText(el, String(value));
  }
  for (const t of touched) touch(t);
  return touched;
};

const applyText = (
  textEl: ExcalidrawElement,
  value: string,
  container?: ExcalidrawElement,
) => {
  const fontSize = textEl.fontSize ?? 20;
  const wrapped = container
    ? wrapText(value, fontSize, container.width - PADDING * 2)
    : value;
  const size = measureText(wrapped, fontSize);
  textEl.text = wrapped;
  textEl.originalText = value;
  textEl.width = size.width;
  textEl.height = size.height;
  if (container) {
    textEl.x = container.x + (container.width - size.width) / 2;
    textEl.y = container.y + (container.height - size.height) / 2;
  }
};

// Soft-delete (isDeleted tombstone, as Excalidraw does) the elements, their
// bound labels, and arrows attached to them.
export const deleteElements = (
  ids: string[],
  all: ExcalidrawElement[],
): string[] => {
  const doomed = new Set(ids);
  for (const el of all) {
    if (el.type === "text" && el.containerId && doomed.has(el.containerId))
      doomed.add(el.id);
    if (
      el.type === "arrow" &&
      (doomed.has(el.startBinding?.elementId) ||
        doomed.has(el.endBinding?.elementId))
    )
      doomed.add(el.id);
  }
  // Labels of removed arrows go too.
  for (const el of all) {
    if (el.type === "text" && el.containerId && doomed.has(el.containerId))
      doomed.add(el.id);
  }
  const changed: string[] = [];
  for (const el of all) {
    if (doomed.has(el.id)) {
      if (!el.isDeleted) {
        el.isDeleted = true;
        touch(el);
        changed.push(el.id);
      }
      continue;
    }
    if (el.boundElements?.some((b: { id: string }) => doomed.has(b.id))) {
      el.boundElements = el.boundElements.filter(
        (b: { id: string }) => !doomed.has(b.id),
      );
      touch(el);
    }
  }
  return changed;
};
