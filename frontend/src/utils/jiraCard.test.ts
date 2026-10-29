import { describe, expect, it } from "vitest";
import { parseJiraReference, wrapTitle } from "./jiraCard";

describe("parseJiraReference", () => {
  it("reads key and link from a browse URL", () => {
    expect(
      parseJiraReference("https://acme.atlassian.net/browse/kern-12"),
    ).toEqual({
      key: "KERN-12",
      url: "https://acme.atlassian.net/browse/kern-12",
    });
  });
  it("accepts a bare key without a link", () => {
    expect(parseJiraReference(" ABC-7 ")).toEqual({ key: "ABC-7", url: undefined });
  });
});

describe("wrapTitle", () => {
  it("truncates to two lines with an ellipsis", () => {
    const lines = wrapTitle("word ".repeat(40), 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
});
