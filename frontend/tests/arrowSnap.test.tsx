import { describe, expect, it } from "vitest";
import {
  attachPoint,
  findMagnetTarget,
  outlinePoint,
  reattachAnchoredArrows,
  snapArrowToAnchors,
} from "../src/pages/editor/arrowSnap";

const rect = {
  id: "r",
  type: "rectangle",
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  angle: 0,
  groupIds: [],
};

const arrowTo = (end: [number, number], endBinding: any) => ({
  type: "arrow",
  id: "a",
  x: 0,
  y: 0,
  width: end[0],
  height: end[1],
  version: 1,
  points: [
    [0, 0],
    [end[0], end[1]],
  ],
  startBinding: null,
  endBinding,
});

const close = (p: number[], q: number[]) => {
  expect(p[0]).toBeCloseTo(q[0], 1);
  expect(p[1]).toBeCloseTo(q[1], 1);
};

describe("outlinePoint", () => {
  it("projects onto the nearest rectangle side", () => {
    close(outlinePoint(rect, [130, 190]).point, [130, 200]);
    close(outlinePoint(rect, [130, 230]).point, [130, 200]);
  });

  it("projects onto ellipses and diamonds", () => {
    const ellipse = { ...rect, type: "ellipse" };
    close(outlinePoint(ellipse, [200, 120]).point, [200, 100]);
    const diamond = { ...rect, type: "diamond" };
    close(outlinePoint(diamond, [150, 125]).point, [150, 125]);
  });
});

describe("attachPoint", () => {
  it("slides along the edge away from anchors", () => {
    const hit = attachPoint(rect, [130, 190], 18);
    expect(hit.side).toBeNull();
    close(hit.target, [130, 204]);
  });

  it("locks onto a side midpoint when close", () => {
    const hit = attachPoint(rect, [188, 195], 18);
    expect(hit.side).toBe(2);
    close(hit.target, [200, 204]);
  });
});

describe("findMagnetTarget", () => {
  it("snaps a pointer over a shape to its edge", () => {
    const hit = findMagnetTarget([rect], [110, 185], 24, 18);
    expect(hit?.element.id).toBe("r");
    close(hit!.target, [96, 185]);
  });

  it("snaps a pointer just outside a shape, but not far away", () => {
    expect(findMagnetTarget([rect], [200, 85], 24, 18)?.side).toBe(0);
    expect(findMagnetTarget([rect], [200, 40], 24, 18)).toBeNull();
  });

  it("skips excluded shapes and prefers the shape under the pointer", () => {
    const top = { ...rect, id: "t", x: 150, y: 120, width: 40, height: 40 };
    expect(findMagnetTarget([rect, top], [170, 140], 24, 18)?.element.id).toBe(
      "t",
    );
    expect(
      findMagnetTarget([rect, top], [170, 140], 24, 18, {
        excludeIds: new Set(["t"]),
      })?.element.id,
    ).toBe("r");
  });

  it("treats a group as one object and snaps to its largest member", () => {
    const card = { ...rect, groupIds: ["g"] };
    const pill = {
      ...rect,
      id: "p",
      x: 110,
      y: 170,
      width: 60,
      height: 20,
      groupIds: ["g"],
    };
    expect(findMagnetTarget([card, pill], [120, 180], 24, 18)?.element.id).toBe(
      "r",
    );
  });
});

describe("snapArrowToAnchors", () => {
  it("attaches a bound end to the outline and records it as fixedPoint", () => {
    const out = snapArrowToAnchors(
      arrowTo([130, 210], { elementId: "r", focus: 0.3, gap: 7 }),
      new Map([["r", rect]]),
      18,
    );
    close(out.points[1], [130, 204]);
    expect(out.endBinding.focus).toBe(0);
    expect(out.endBinding.fixedPoint[0]).toBeCloseTo(0.15);
    expect(out.version).toBe(2);
  });

  it("is a no-op once attached", () => {
    const once = snapArrowToAnchors(
      arrowTo([130, 210], { elementId: "r", focus: 0.3, gap: 7 }),
      new Map([["r", rect]]),
      18,
    );
    expect(snapArrowToAnchors(once, new Map([["r", rect]]), 18)).toBeNull();
  });

  it("ignores elbow arrows", () => {
    const elbow = {
      ...arrowTo([96, 150], { elementId: "r", focus: 0, gap: 4 }),
      elbowed: true,
    };
    expect(snapArrowToAnchors(elbow, new Map([["r", rect]]), 18)).toBeNull();
  });
});

describe("reattachAnchoredArrows", () => {
  it("moves an attached end with its shape", () => {
    const attached = snapArrowToAnchors(
      arrowTo([130, 204], { elementId: "r", focus: 0, gap: 4 }),
      new Map([["r", rect]]),
      18,
    );
    const moved = { ...rect, x: 300, y: 400 };
    const [fixed] = reattachAnchoredArrows([moved, attached]);
    close(fixed.points[1], [330, 504]);
    expect(reattachAnchoredArrows([moved, fixed])).toEqual([]);
  });

  it("does not touch arrows without a fixedPoint, or with one inside the shape", () => {
    expect(
      reattachAnchoredArrows([
        rect,
        arrowTo([50, 50], { elementId: "r", focus: 0, gap: 4 }),
      ]),
    ).toEqual([]);
    expect(
      reattachAnchoredArrows([
        rect,
        arrowTo([50, 50], {
          elementId: "r",
          focus: 0,
          gap: 4,
          fixedPoint: [0.5001, 0.5001],
        }),
      ]),
    ).toEqual([]);
  });
});
