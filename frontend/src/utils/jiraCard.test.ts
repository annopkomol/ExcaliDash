import { describe, expect, it } from "vitest";
import {
  buildJiraCardElements,
  parseJiraGroupId,
  parseJiraReference,
  refreshJiraCards,
  wrapTitle,
} from "./jiraCard";

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
    expect(parseJiraReference(" ABC-7 ")).toEqual({
      key: "ABC-7",
      url: undefined,
    });
  });
});

describe("wrapTitle", () => {
  it("truncates to two lines with an ellipsis", () => {
    const lines = wrapTitle("word ".repeat(40), 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
});

describe("refreshJiraCards", () => {
  const card = (key: string, groupId: string, x: number) =>
    buildJiraCardElements(
      {
        key,
        title: "Old title",
        issueType: "task",
        status: "To Do",
        statusCategory: "todo",
      },
      { x, y: 0 },
      groupId,
    );

  it("recovers the issue key from the group id", () => {
    expect(parseJiraGroupId("jira-KERN-12-ab12cd34")).toBe("KERN-12");
    expect(parseJiraGroupId("some-other-group")).toBeNull();
  });

  it("replaces only the targeted card in place and soft-deletes the old one", async () => {
    const a = card("KERN-1", "jira-KERN-1-aaaa1111", 0);
    const b = card("KERN-2", "jira-KERN-2-bbbb2222", 500);
    const result = await refreshJiraCards(
      [...a, ...b],
      ["jira-KERN-1-aaaa1111"],
      async (key) => ({
        key,
        summary: "New title",
        issueType: "bug",
        status: "Done",
        statusCategory: "done",
        assignee: null,
        url: `https://x.atlassian.net/browse/${key}`,
      }),
    );
    expect(result).toMatchObject({ updated: 1, failed: 0 });
    const live = result.elements.filter((el) => !el.isDeleted);
    expect(live.some((el) => el.text === "DONE")).toBe(true);
    expect(
      live.filter((el) => el.groupIds.includes("jira-KERN-2-bbbb2222")),
    ).toHaveLength(b.length);
    expect(result.elements.filter((el) => el.isDeleted)).toHaveLength(a.length);
    expect(
      live.find((el) => el.text === "New title")?.x,
    ).toBeGreaterThanOrEqual(0);
  });

  it("counts failures and leaves the card untouched", async () => {
    const a = card("KERN-1", "jira-KERN-1-aaaa1111", 0);
    const result = await refreshJiraCards(
      a,
      ["jira-KERN-1-aaaa1111"],
      async () => {
        throw new Error("nope");
      },
    );
    expect(result).toMatchObject({ updated: 0, failed: 1 });
    expect(result.elements.every((el) => !el.isDeleted)).toBe(true);
  });
});
