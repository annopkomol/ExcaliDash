/**
 * Miro-style arrow snapping. Arrow ends slide along a shape's outline, lock
 * onto the side-midpoint anchors (top, right, bottom, left) when close to one,
 * and stay on that spot of the outline when the shape moves. Only standard Excalidraw arrow fields are written: points and
 * start/endBinding, where the anchor is stored as the binding's `fixedPoint`
 * (the same field Excalidraw uses for elbow arrows and, in newer versions, for
 * every arrow), so scenes stay valid when pasted into excalidraw.com.
 */

type Point = [number, number];

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
};

export type Anchor = { point: Point; normal: Point };

/** Gap between an anchored arrow end and the shape outline, in scene units. */
export const ANCHOR_GAP = 4;

const rotate = ([x, y]: Point, angle: number): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
};

const center = (el: Box): Point => [el.x + el.width / 2, el.y + el.height / 2];

/** Pointer position in the element's unrotated frame, relative to its center. */
const toLocal = (el: Box, p: Point): Point => {
  const [cx, cy] = center(el);
  return rotate([p[0] - cx, p[1] - cy], -(el.angle ?? 0));
};

const SIDES: Array<{ offset: (w: number, h: number) => Point; normal: Point }> =
  [
    { offset: (_w, h) => [0, -h / 2], normal: [0, -1] },
    { offset: (w) => [w / 2, 0], normal: [1, 0] },
    { offset: (_w, h) => [0, h / 2], normal: [0, 1] },
    { offset: (w) => [-w / 2, 0], normal: [-1, 0] },
  ];

/** Side midpoints (top, right, bottom, left) of a possibly rotated element, with outward normals. */
export const getElementAnchors = (el: Box): Anchor[] => {
  const angle = el.angle ?? 0;
  const [cx, cy] = center(el);
  return SIDES.map(({ offset, normal }) => {
    const [ox, oy] = rotate(offset(el.width, el.height), angle);
    return { point: [cx + ox, cy + oy], normal: rotate(normal, angle) };
  });
};

/** Global position for a binding fixedPoint, as Excalidraw computes it for elbow arrows. */
const fixedPointToGlobal = (el: Box, fp: Point): Point => {
  const [cx, cy] = center(el);
  const local: Point = [
    el.x + fp[0] * el.width - cx,
    el.y + fp[1] * el.height - cy,
  ];
  const [rx, ry] = rotate(local, el.angle ?? 0);
  return [cx + rx, cy + ry];
};

// Excalidraw rejects an exact 0.5 ratio (normalizeFixedPoint), so mirror it.
const avoidHalf = (v: number) => (Math.abs(v - 0.5) < 0.0001 ? 0.5001 : v);

/** Binding `fixedPoint` (ratio of the unrotated box) for a global point. */
const globalToFixedPoint = (el: Box, g: Point): Point => {
  const [lx, ly] = toLocal(el, g);
  return [
    avoidHalf(el.width ? 0.5 + lx / el.width : 0.5),
    avoidHalf(el.height ? 0.5 + ly / el.height : 0.5),
  ];
};

const normalize = ([x, y]: Point): Point => {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
};

/** Nearest point on the shape outline (unrotated frame, relative to center) and its outward normal. */
const localOutlinePoint = (
  type: string,
  a: number,
  b: number,
  [lx, ly]: Point,
): Anchor => {
  if (type === "ellipse" && a > 0 && b > 0) {
    const t = Math.atan2(ly / b, lx / a);
    const [c, s] = [Math.cos(t), Math.sin(t)];
    return { point: [a * c, b * s], normal: normalize([c / a, s / b]) };
  }
  if (type === "diamond" && a > 0 && b > 0) {
    const sx = lx >= 0 ? 1 : -1;
    const sy = ly >= 0 ? 1 : -1;
    // Edge of this quadrant, from (0, sy*b) to (sx*a, 0).
    const ex = sx * a;
    const ey = -sy * b;
    const t = Math.min(
      1,
      Math.max(0, (lx * ex + (ly - sy * b) * ey) / (ex * ex + ey * ey)),
    );
    return {
      point: [t * ex, sy * b + t * ey],
      normal: normalize([sx * b, sy * a]),
    };
  }
  // Rectangles and everything else bind to their box.
  const outside = Math.abs(lx) > a || Math.abs(ly) > b;
  if (outside) {
    const px = Math.max(-a, Math.min(a, lx));
    const py = Math.max(-b, Math.min(b, ly));
    const horizontal = Math.abs(lx) - a > Math.abs(ly) - b;
    return {
      point: [px, py],
      normal: horizontal ? [Math.sign(lx) || 1, 0] : [0, Math.sign(ly) || 1],
    };
  }
  if (a - Math.abs(lx) < b - Math.abs(ly)) {
    const sx = lx >= 0 ? 1 : -1;
    return { point: [sx * a, ly], normal: [sx, 0] };
  }
  const sy = ly >= 0 ? 1 : -1;
  return { point: [lx, sy * b], normal: [0, sy] };
};

/** Nearest point on a (possibly rotated) element's outline, with its outward normal. */
export const outlinePoint = (el: Box & { type?: string }, p: Point): Anchor => {
  const angle = el.angle ?? 0;
  const [cx, cy] = center(el);
  const local = localOutlinePoint(
    el.type ?? "rectangle",
    el.width / 2,
    el.height / 2,
    toLocal(el, p),
  );
  const [ox, oy] = rotate(local.point, angle);
  return { point: [cx + ox, cy + oy], normal: rotate(local.normal, angle) };
};

/**
 * Where an arrow end near `p` attaches on the element: the nearest outline
 * point, or a side-midpoint anchor (`side` 0-3) when within `lockRadius` of it.
 */
export const attachPoint = (
  el: Box & { type?: string },
  p: Point,
  lockRadius: number,
  gap = ANCHOR_GAP,
): { side: number | null; target: Point } => {
  const edge = outlinePoint(el, p);
  let best: { side: number | null; anchor: Anchor; dist: number } = {
    side: null,
    anchor: edge,
    dist: lockRadius,
  };
  getElementAnchors(el).forEach((anchor, side) => {
    const dist = Math.hypot(
      anchor.point[0] - edge.point[0],
      anchor.point[1] - edge.point[1],
    );
    if (dist <= best.dist) best = { side, anchor, dist };
  });
  const { point, normal } = best.anchor;
  return {
    side: best.side,
    target: [point[0] + normal[0] * gap, point[1] + normal[1] * gap],
  };
};

/** Whether a binding fixedPoint sits on the element outline, i.e. was attached by us. */
const isEdgeFixedPoint = (el: Box & { type?: string }, fp: unknown) => {
  if (!Array.isArray(fp) || fp.length !== 2) return false;
  if (!fp.every((v) => Number.isFinite(v))) return false;
  const g = fixedPointToGlobal(el, fp as Point);
  const { point } = outlinePoint(el, g);
  const tolerance = Math.max(8, 0.1 * Math.min(el.width, el.height));
  return Math.hypot(g[0] - point[0], g[1] - point[1]) <= tolerance;
};

const BINDABLE = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "text",
  "image",
  "iframe",
  "embeddable",
]);

/** Distance outside the unrotated box (0 when inside). */
const distanceOutside = (el: Box, p: Point) => {
  const [lx, ly] = toLocal(el, p);
  const dx = Math.max(Math.abs(lx) - el.width / 2, 0);
  const dy = Math.max(Math.abs(ly) - el.height / 2, 0);
  return Math.hypot(dx, dy);
};

export type MagnetHit = {
  element: any;
  side: number | null;
  target: Point;
};

/**
 * Where an arrow end at `p` should snap to: the outline of any bindable shape
 * the pointer is over or within `margin` of, locking onto a side midpoint
 * within `lockRadius`. Grouped shapes (e.g. Jira cards) act as one object and
 * snap to their largest member.
 */
export const findMagnetTarget = (
  elements: readonly any[],
  p: Point,
  margin: number,
  lockRadius: number,
  options: { excludeIds?: Set<string>; editingGroupId?: string | null } = {},
): MagnetHit | null => {
  const candidates: Array<{ el: any; dist: number }> = [];
  for (const el of elements) {
    if (
      !el ||
      el.isDeleted ||
      !BINDABLE.has(el.type) ||
      el.containerId ||
      options.excludeIds?.has(el.id)
    ) {
      continue;
    }
    const dist = distanceOutside(el, p);
    if (dist <= margin) candidates.push({ el, dist });
  }
  if (!candidates.length) return null;
  // Over a shape beats near a shape; shapes beat free text; topmost wins.
  const rank = ({ el, dist }: { el: any; dist: number }) =>
    (dist === 0 ? 2 : 0) + (el.type === "text" ? 0 : 1);
  let best = candidates[candidates.length - 1];
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (rank(candidates[i]) > rank(best)) best = candidates[i];
  }
  let element = best.el;
  const outerGroup: string | undefined =
    element.groupIds?.[element.groupIds.length - 1];
  if (outerGroup && options.editingGroupId !== outerGroup) {
    const area = (el: any) => el.width * el.height;
    for (const { el } of candidates) {
      if (
        el.groupIds?.includes(outerGroup) &&
        el.type !== "text" &&
        area(el) > area(element)
      ) {
        element = el;
      }
    }
  }
  return { element, ...attachPoint(element, p, lockRadius) };
};

type Binding = {
  elementId: string;
  focus: number;
  gap: number;
  fixedPoint?: Point | null;
} | null;

const withEndpoint = (arrow: any, end: "start" | "end", target: Point) => {
  const points: Point[] = arrow.points.map((p: number[]) => [p[0], p[1]]);
  let x = arrow.x;
  let y = arrow.y;
  if (end === "end") {
    points[points.length - 1] = [target[0] - x, target[1] - y];
  } else {
    // Point 0 must stay at the arrow origin, so move the origin and shift the rest.
    const dx = target[0] - x;
    const dy = target[1] - y;
    x = target[0];
    y = target[1];
    for (let i = 0; i < points.length; i++) {
      points[i] = i === 0 ? [0, 0] : [points[i][0] - dx, points[i][1] - dy];
    }
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    x,
    y,
    points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

const bumpVersion = (next: any, prev: any) => ({
  ...next,
  version: prev.version + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
});

const isPlainArrow = (arrow: any) =>
  arrow?.type === "arrow" &&
  !arrow.elbowed &&
  !arrow.isDeleted &&
  Array.isArray(arrow.points) &&
  arrow.points.length >= 2;

const endpointOf = (arrow: any, end: "start" | "end"): Point => {
  const p = arrow.points[end === "start" ? 0 : arrow.points.length - 1];
  return [arrow.x + p[0], arrow.y + p[1]];
};

/**
 * After a pointer-up: attach each bound end of the arrow to the nearest point
 * of its shape's outline (or a side midpoint within `lockRadius`) and record
 * it as the binding's fixedPoint. Returns the updated arrow, or null if
 * nothing changed.
 */
export const snapArrowToAnchors = (
  arrow: any,
  elementsById: Map<string, any>,
  lockRadius: number,
): any | null => {
  if (!isPlainArrow(arrow)) return null;
  let next = arrow;
  for (const end of ["start", "end"] as const) {
    const key = end === "start" ? "startBinding" : "endBinding";
    const binding: Binding = next[key];
    const target = binding && elementsById.get(binding.elementId);
    if (!binding || !target || target.isDeleted) continue;
    const current = endpointOf(next, end);
    if (
      binding.focus === 0 &&
      binding.fixedPoint &&
      isEdgeFixedPoint(target, binding.fixedPoint)
    ) {
      const want = fixedPointToGlobal(target, binding.fixedPoint);
      if (Math.hypot(want[0] - current[0], want[1] - current[1]) <= 0.5) {
        continue;
      }
    }
    const fixedPoint = globalToFixedPoint(
      target,
      attachPoint(target, current, lockRadius).target,
    );
    next = {
      ...next,
      ...withEndpoint(next, end, fixedPointToGlobal(target, fixedPoint)),
      [key]: { ...binding, focus: 0, gap: ANCHOR_GAP, fixedPoint },
    };
  }
  return next === arrow ? null : bumpVersion(next, arrow);
};

/**
 * Keep attached arrow ends on their spot of the outline after the shapes they attach to
 * moved, resized or rotated (Excalidraw 0.18 only does this for elbow arrows).
 * Returns the arrows that needed fixing.
 */
export const reattachAnchoredArrows = (
  elements: readonly any[],
  skipIds: Set<string> = new Set(),
): any[] => {
  let byId: Map<string, any> | null = null;
  const fixed: any[] = [];
  for (const arrow of elements) {
    if (!isPlainArrow(arrow) || skipIds.has(arrow.id)) continue;
    if (!arrow.startBinding?.fixedPoint && !arrow.endBinding?.fixedPoint) {
      continue;
    }
    byId ??= new Map(elements.map((el) => [el.id, el]));
    let next = arrow;
    for (const end of ["start", "end"] as const) {
      const binding = next[`${end}Binding`];
      const target = binding?.fixedPoint && byId.get(binding.elementId);
      if (!target || target.isDeleted) continue;
      if (!isEdgeFixedPoint(target, binding.fixedPoint)) continue;
      const want = fixedPointToGlobal(target, binding.fixedPoint);
      const have = endpointOf(next, end);
      if (Math.hypot(want[0] - have[0], want[1] - have[1]) <= 0.5) continue;
      next = { ...next, ...withEndpoint(next, end, want) };
    }
    if (next !== arrow) fixed.push(bumpVersion(next, arrow));
  }
  return fixed;
};
