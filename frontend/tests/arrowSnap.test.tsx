import { describe, expect, it } from "vitest";
import {
  findSnapTarget,
  snapArrowToAnchors,
} from "../src/pages/editor/arrowSnap";

const rect = {
  id: "r",
  type: "rectangle",
  x: 100,
  y: 100,
  width: 200,
  height: 100,
};

describe("arrowSnap", () => {
  it("snaps a nearby point to the side midpoint offset by the gap", () => {
    expect(findSnapTarget(rect, [210, 96], 5)).toEqual([200, 95]);
  });

  it("does not snap a point far from every anchor", () => {
    expect(findSnapTarget(rect, [150, 100], 5)).toBeNull();
  });

  it("snaps the bound end of an arrow and keeps standard bindings", () => {
    const arrow = {
      type: "arrow",
      id: "a",
      x: 0,
      y: 0,
      width: 195,
      height: 95,
      version: 1,
      points: [
        [0, 0],
        [195, 95],
      ],
      startBinding: null,
      endBinding: { elementId: "r", focus: 0.3, gap: 5 },
    };
    const out = snapArrowToAnchors(arrow, new Map([["r", rect]]));
    expect(out.points[1]).toEqual([200, 95]);
    expect(out.endBinding).toEqual({ elementId: "r", focus: 0, gap: 5 });
    expect(out.version).toBe(2);
  });

  it("moves the origin when snapping the start of an arrow", () => {
    const arrow = {
      type: "arrow",
      id: "a",
      x: 205,
      y: 90,
      width: 0,
      height: 100,
      version: 1,
      points: [
        [0, 0],
        [0, -100],
      ],
      startBinding: { elementId: "r", focus: 0, gap: 5 },
      endBinding: null,
    };
    const out = snapArrowToAnchors(arrow, new Map([["r", rect]]));
    expect([out.x, out.y]).toEqual([200, 95]);
    expect(out.points).toEqual([
      [0, 0],
      [5, -105],
    ]);
  });

  it("ignores elbow arrows and unbound arrows", () => {
    const base = {
      type: "arrow",
      id: "a",
      x: 0,
      y: 0,
      version: 1,
      points: [
        [0, 0],
        [1, 1],
      ],
      startBinding: null,
      endBinding: null,
    };
    expect(snapArrowToAnchors(base, new Map())).toBeNull();
    expect(
      snapArrowToAnchors(
        {
          ...base,
          elbowed: true,
          endBinding: { elementId: "r", focus: 0, gap: 5 },
        },
        new Map([["r", rect]]),
      ),
    ).toBeNull();
  });
});
