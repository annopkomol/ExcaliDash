import { describe, expect, it } from "vitest";
import { dropLegacyBindingsOnDeletedArrows } from "../src/utils/legacyBindings";

describe("dropLegacyBindingsOnDeletedArrows", () => {
  const legacy = { elementId: "a", focus: 0, gap: 1 };
  const modern = { elementId: "a", mode: "orbit", fixedPoint: [0.5, 0.5] };

  it("clears legacy bindings on deleted arrows only", () => {
    const deleted = { id: "1", type: "arrow", isDeleted: true, startBinding: legacy, endBinding: modern };
    const live = { id: "2", type: "arrow", isDeleted: false, startBinding: legacy, endBinding: null };
    const [d, l] = dropLegacyBindingsOnDeletedArrows([deleted, live]) as any[];
    expect(d.startBinding).toBeNull();
    expect(d.endBinding).toBe(modern);
    expect(l).toBe(live);
  });

  it("returns the same array when nothing needs changing", () => {
    const els = [{ id: "1", type: "arrow", isDeleted: true, startBinding: modern, endBinding: null }];
    expect(dropLegacyBindingsOnDeletedArrows(els)).toBe(els);
  });
});
