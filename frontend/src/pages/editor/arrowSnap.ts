/**
 * Miro-style arrow snapping. After an arrow endpoint is bound to a shape, move
 * it onto the nearest side-midpoint anchor of that shape when it is close
 * enough. Only standard arrow fields (points, startBinding, endBinding) are
 * written, so the result stays valid when pasted into excalidraw.com.
 */

type Point = [number, number];

export type Anchor = { point: Point; normal: Point };

const rotate = ([x, y]: Point, angle: number): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
};

/** Side midpoints (top, right, bottom, left) of a possibly rotated element, with outward normals. */
export const getElementAnchors = (el: {
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
}): Anchor[] => {
  const angle = el.angle ?? 0;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const sides: Array<[Point, Point]> = [
    [
      [0, -el.height / 2],
      [0, -1],
    ],
    [
      [el.width / 2, 0],
      [1, 0],
    ],
    [
      [0, el.height / 2],
      [0, 1],
    ],
    [
      [-el.width / 2, 0],
      [-1, 0],
    ],
  ];
  return sides.map(([offset, normal]) => {
    const [ox, oy] = rotate(offset, angle);
    return { point: [cx + ox, cy + oy], normal: rotate(normal, angle) };
  });
};

const snapRadius = (el: { width: number; height: number }, zoom: number) => {
  const preferred = Math.max(28 / zoom, 0.25 * Math.min(el.width, el.height));
  // Never reach past halfway to the next anchor.
  return Math.min(preferred, 0.4 * Math.hypot(el.width / 2, el.height / 2));
};

/** Anchor (plus binding gap) the point should snap to, or null if none is close enough. */
export const findSnapTarget = (
  el: { x: number; y: number; width: number; height: number; angle?: number },
  point: Point,
  gap: number,
  zoom = 1,
): Point | null => {
  const radius = snapRadius(el, zoom);
  let best: { dist: number; target: Point } | null = null;
  for (const { point: a, normal } of getElementAnchors(el)) {
    const dist = Math.hypot(point[0] - a[0], point[1] - a[1]);
    if (dist <= radius && (!best || dist < best.dist)) {
      best = { dist, target: [a[0] + normal[0] * gap, a[1] + normal[1] * gap] };
    }
  }
  return best ? best.target : null;
};

type Binding = { elementId: string; focus: number; gap: number } | null;

const setEndpoint = (arrow: any, end: "start" | "end", target: Point) => {
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

/** Returns an updated arrow with its bound ends snapped to anchors, or null if nothing changed. */
export const snapArrowToAnchors = (
  arrow: any,
  elementsById: Map<string, any>,
  zoom = 1,
): any | null => {
  if (
    arrow?.type !== "arrow" ||
    arrow.elbowed ||
    arrow.isDeleted ||
    !Array.isArray(arrow.points) ||
    arrow.points.length < 2
  ) {
    return null;
  }
  let next = arrow;
  let changed = false;
  for (const end of ["start", "end"] as const) {
    const binding: Binding =
      end === "start" ? next.startBinding : next.endBinding;
    const target = binding && elementsById.get(binding.elementId);
    if (!binding || !target || target.isDeleted) continue;
    const index = end === "start" ? 0 : next.points.length - 1;
    const current: Point = [
      next.x + next.points[index][0],
      next.y + next.points[index][1],
    ];
    const snapped = findSnapTarget(target, current, binding.gap, zoom);
    if (!snapped) continue;
    const moved =
      Math.hypot(snapped[0] - current[0], snapped[1] - current[1]) > 0.01;
    const refocus = binding.focus !== 0;
    if (!moved && !refocus) continue;
    next = {
      ...next,
      ...setEndpoint(next, end, snapped),
      [end === "start" ? "startBinding" : "endBinding"]: {
        ...binding,
        focus: 0,
      },
    };
    changed = true;
  }
  if (!changed) return null;
  return {
    ...next,
    version: arrow.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
};
