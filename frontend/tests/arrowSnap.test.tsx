import { describe, expect, it } from "vitest";
import {
  findMagnetTarget,
  reattachAnchoredArrows,
  sideOfFixedPoint,
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

describe("findMagnetTarget", () => {
  it("snaps a pointer anywhere over a shape to the nearest side midpoint", () => {
    const hit = findMagnetTarget([rect], [130, 160], 24);
    expect(hit?.element.id).toBe("r");
    expect(hit?.side).toBe(3);
    expect(hit?.target).toEqual([96, 150]);
  });

  it("snaps a pointer just outside a shape, but not far away", () => {
    expect(findMagnetTarget([rect], [200, 85], 24)?.side).toBe(0);
    expect(findMagnetTarget([rect], [200, 40], 24)).toBeNull();
  });

  it("skips excluded shapes and prefers the shape under the pointer", () => {
    const top = { ...rect, id: "t", x: 150, y: 120, width: 40, height: 40 };
    expect(findMagnetTarget([rect, top], [170, 140], 24)?.element.id).toBe("t");
    expect(
      findMagnetTarget([rect, top], [170, 140], 24, {
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
    expect(findMagnetTarget([card, pill], [120, 180], 24)?.element.id).toBe(
      "r",
    );
  });
});

describe("snapArrowToAnchors", () => {
  it("attaches a bound end near an anchor and records the anchor as fixedPoint", () => {
    const out = snapArrowToAnchors(
      arrowTo([95, 140], { elementId: "r", focus: 0.3, gap: 5 }),
      new Map([["r", rect]]),
    );
    expect(out.points[1][0]).toBeCloseTo(96);
    expect(out.points[1][1]).toBeCloseTo(150, 1);
    expect(out.endBinding.focus).toBe(0);
    expect(sideOfFixedPoint(out.endBinding.fixedPoint)).toBe(3);
    expect(out.version).toBe(2);
  });

  it("leaves a bound end far from every anchor alone", () => {
    expect(
      snapArrowToAnchors(
        arrowTo([110, 97], { elementId: "r", focus: 0.3, gap: 3 }),
        new Map([["r", rect]]),
      ),
    ).toBeNull();
  });

  it("ignores elbow arrows", () => {
    const elbow = {
      ...arrowTo([96, 150], { elementId: "r", focus: 0, gap: 4 }),
      elbowed: true,
    };
    expect(snapArrowToAnchors(elbow, new Map([["r", rect]]))).toBeNull();
  });
});

describe("reattachAnchoredArrows", () => {
  it("moves an anchored end with its shape", () => {
    const anchored = snapArrowToAnchors(
      arrowTo([96, 150], { elementId: "r", focus: 0, gap: 4 }),
      new Map([["r", rect]]),
    );
    const moved = { ...rect, x: 300, y: 400 };
    const [fixed] = reattachAnchoredArrows([moved, anchored]);
    expect(fixed.points[1][0]).toBeCloseTo(296);
    expect(fixed.points[1][1]).toBeCloseTo(450, 1);
    expect(reattachAnchoredArrows([moved, fixed])).toEqual([]);
  });

  it("does not touch arrows without an anchor", () => {
    expect(
      reattachAnchoredArrows([
        rect,
        arrowTo([50, 50], { elementId: "r", focus: 0, gap: 4 }),
      ]),
    ).toEqual([]);
  });
});
