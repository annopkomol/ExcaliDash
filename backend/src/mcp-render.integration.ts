import { describe, expect, it } from "vitest";
import { elementsToSvg } from "./mcp/render";

describe("MCP render", () => {
  it("draws upstream sticky notes instead of dropping them", () => {
    const note: any = {
      id: "n1",
      type: "stickynote",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "#ffdd66",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      isDeleted: false,
    };
    const { svg } = elementsToSvg([note]);
    expect(svg).toContain("<rect");
    expect(svg).toContain("#ffdd66");
  });
});
