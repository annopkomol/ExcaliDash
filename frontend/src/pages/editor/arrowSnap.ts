/**
 * Miro-style arrow snapping. Arrow ends attach to the side-midpoint anchors
 * (top, right, bottom, left) of shapes and stay on that anchor when the shape
 * moves. Only standard Excalidraw arrow fields are written: points and
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

/** Global position an arrow end attached to `side` should sit at. */
export const anchorEndpoint = (
  el: Box,
  side: number,
  gap = ANCHOR_GAP,
): Point => {
  const { point, normal } = getElementAnchors(el)[side];
  return [point[0] + normal[0] * gap, point[1] + normal[1] * gap];
};

// Excalidraw rejects an exact 0.5 ratio (normalizeFixedPoint), so mirror it.
const HALF = 0.5001;

/** Binding `fixedPoint` (ratio of the unrotated box) for an end attached to `side`. */
export const sideFixedPoint = (el: Box, side: number, gap: number): Point => {
  const gx = el.width ? gap / el.width : 0;
  const gy = el.height ? gap / el.height : 0;
  return [
    [HALF, -gy],
    [1 + gx, HALF],
    [HALF, 1 + gy],
    [-gx, HALF],
  ][side] as Point;
};

/** Which side anchor a fixedPoint written by `sideFixedPoint` refers to, if any. */
export const sideOfFixedPoint = (fp: unknown): number | null => {
  if (!Array.isArray(fp) || fp.length !== 2) return null;
  const [fx, fy] = fp as number[];
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  const mid = (v: number) => Math.abs(v - 0.5) < 0.001;
  if (mid(fx) && fy <= 0) return 0;
  if (mid(fy) && fx >= 1) return 1;
  if (mid(fx) && fy >= 1) return 2;
  if (mid(fy) && fx <= 0) return 3;
  return null;
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

/** The side whose midpoint a point inside (or near) the element should attach to. */
export const nearestSide = (el: Box, p: Point): number => {
  const [lx, ly] = toLocal(el, p);
  const nx = el.width ? lx / (el.width / 2) : 0;
  const ny = el.height ? ly / (el.height / 2) : 0;
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 1 : 3;
  return ny >= 0 ? 2 : 0;
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

export type MagnetHit = { element: any; side: number; target: Point };

/**
 * The shape and anchor an arrow end at `p` should snap to: any bindable shape
 * the pointer is over, or within `margin` of. Grouped shapes (e.g. Jira cards)
 * act as one object and snap to their largest member's anchors.
 */
export const findMagnetTarget = (
  elements: readonly any[],
  p: Point,
  margin: number,
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
  const side = nearestSide(element, p);
  return { element, side, target: anchorEndpoint(element, side) };
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

/** Radius around an anchor within which a just-bound arrow end snaps to it on release. */
const releaseRadius = (el: Box, zoom: number) => {
  const preferred = Math.max(28 / zoom, 0.25 * Math.min(el.width, el.height));
  // Never reach past halfway to the next anchor.
  return Math.min(preferred, 0.4 * Math.hypot(el.width / 2, el.height / 2));
};

/**
 * After a pointer-up: attach each bound end of the arrow that sits near an
 * anchor (or already carries one) to that anchor. Returns the updated arrow,
 * or null if nothing changed.
 */
export const snapArrowToAnchors = (
  arrow: any,
  elementsById: Map<string, any>,
  zoom = 1,
): any | null => {
  if (!isPlainArrow(arrow)) return null;
  let next = arrow;
  for (const end of ["start", "end"] as const) {
    const key = end === "start" ? "startBinding" : "endBinding";
    const binding: Binding = next[key];
    const target = binding && elementsById.get(binding.elementId);
    if (!binding || !target || target.isDeleted) continue;
    const current = endpointOf(next, end);
    let side = sideOfFixedPoint(binding.fixedPoint);
    if (side === null) {
      const nearest = nearestSide(target, current);
      const { point } = getElementAnchors(target)[nearest];
      if (
        Math.hypot(current[0] - point[0], current[1] - point[1]) >
        releaseRadius(target, zoom)
      ) {
        continue;
      }
      side = nearest;
    }
    const gap = ANCHOR_GAP;
    const fixedPoint = sideFixedPoint(target, side, gap);
    const snapped = fixedPointToGlobal(target, fixedPoint);
    const moved =
      Math.hypot(snapped[0] - current[0], snapped[1] - current[1]) > 0.01;
    const sameBinding =
      binding.focus === 0 &&
      binding.gap === gap &&
      sideOfFixedPoint(binding.fixedPoint) === side &&
      binding.fixedPoint?.[0] === fixedPoint[0] &&
      binding.fixedPoint?.[1] === fixedPoint[1];
    if (!moved && sameBinding) continue;
    next = {
      ...next,
      ...withEndpoint(next, end, snapped),
      [key]: { ...binding, focus: 0, gap, fixedPoint },
    };
  }
  return next === arrow ? null : bumpVersion(next, arrow);
};

/**
 * Keep anchored arrow ends on their anchor after the shapes they attach to
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
    const anchored = (["start", "end"] as const).filter(
      (end) => sideOfFixedPoint(arrow[`${end}Binding`]?.fixedPoint) !== null,
    );
    if (!anchored.length) continue;
    byId ??= new Map(elements.map((el) => [el.id, el]));
    let next = arrow;
    for (const end of anchored) {
      const binding = next[`${end}Binding`];
      const target = byId.get(binding.elementId);
      if (!target || target.isDeleted) continue;
      const want = fixedPointToGlobal(target, binding.fixedPoint);
      const have = endpointOf(next, end);
      if (Math.hypot(want[0] - have[0], want[1] - have[1]) <= 0.5) continue;
      next = { ...next, ...withEndpoint(next, end, want) };
    }
    if (next !== arrow) fixed.push(bumpVersion(next, arrow));
  }
  return fixed;
};
