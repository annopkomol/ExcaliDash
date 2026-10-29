import { describe, expect, it } from "vitest";
import {
  filterMentionNames,
  findMentionToken,
} from "../src/pages/editor/mentionToken";

describe("findMentionToken", () => {
  it("detects @ at start and after whitespace", () => {
    expect(findMentionToken("@no", 3)).toEqual({ start: 0, end: 3, query: "no" });
    expect(findMentionToken("hi @", 4)).toEqual({ start: 3, end: 4, query: "" });
  });
  it("ignores emails and non-trailing text", () => {
    expect(findMentionToken("a@b.com", 7)).toBeNull();
    expect(findMentionToken("@no hello", 9)).toBeNull();
  });
});

describe("filterMentionNames", () => {
  it("ranks prefix matches before substring matches", () => {
    expect(filterMentionNames(["Anna", "Nop", "Xnop"], "no")).toEqual(["Nop", "Xnop"]);
    expect(filterMentionNames(["Anna", "Nop"], "")).toEqual(["Anna", "Nop"]);
  });
});
