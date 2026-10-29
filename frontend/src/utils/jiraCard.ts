/**
 * Builds a Jira-style issue card out of plain Excalidraw elements (rectangles,
 * text, ellipse, image) sharing one groupId; the card background carries the `link`. No custom element types or
 * customData, so the card copy-pastes into excalidraw.com unchanged.
 */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

export type JiraIssueType = "task" | "bug" | "story" | "epic";
export type JiraStatusCategory = "todo" | "inprogress" | "done";

export interface JiraCardInput {
  key: string;
  title: string;
  url?: string;
  issueType: JiraIssueType;
  status: string;
  statusCategory: JiraStatusCategory;
  assignee?: string;
  /** BinaryFiles id of an already-registered circular avatar image. */
  avatarFileId?: string;
}

export const JIRA_TYPES: Record<
  JiraIssueType,
  { label: string; color: string; glyph: string }
> = {
  task: { label: "Task", color: "#4bade8", glyph: "T" },
  bug: { label: "Bug", color: "#e5493a", glyph: "B" },
  story: { label: "Story", color: "#63ba3c", glyph: "S" },
  epic: { label: "Epic", color: "#904ee2", glyph: "E" },
};

const STATUS_COLORS: Record<JiraStatusCategory, { bg: string; fg: string }> = {
  todo: { bg: "#dfe1e6", fg: "#42526e" },
  inprogress: { bg: "#cce0ff", fg: "#0747a6" },
  done: { bg: "#c9f0d3", fg: "#216e4e" },
};

const CARD_WIDTH = 320;
const TITLE_CHARS = 36;

const JIRA_URL_RE =
  /^https:\/\/[a-z0-9-]+\.atlassian\.net\/(?:browse\/([A-Z][A-Z0-9_]+-\d+)(?:[/?#]\S*)?|\S*[?&]selectedIssue=([A-Z][A-Z0-9_]+-\d+)\S*)$/i;

/** Matches clipboard text that is exactly one Jira Cloud issue link. */
export const parseJiraIssueUrl = (
  text: string,
): { key: string; url: string } | null => {
  const value = text.trim();
  const match = JIRA_URL_RE.exec(value);
  const key = match?.[1] ?? match?.[2];
  return key ? { key: key.toUpperCase(), url: value } : null;
};

/** Extract an issue key and a link from a pasted Jira URL or bare key. */
export const parseJiraReference = (
  raw: string,
): { key: string; url?: string } => {
  const value = raw.trim();
  const match = value.match(/([A-Z][A-Z0-9_]+-\d+)/i);
  const key = match ? match[1].toUpperCase() : "";
  const url = /^https?:\/\//i.test(value) ? value : undefined;
  return { key, url };
};

export const wrapTitle = (
  title: string,
  maxChars = TITLE_CHARS,
  maxLines = 2,
) => {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines.length ? lines : [""];
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

export const buildJiraCardElements = (
  input: JiraCardInput,
  origin: { x: number; y: number },
  groupId: string,
) => {
  const { x, y } = origin;
  const type = JIRA_TYPES[input.issueType];
  const status = STATUS_COLORS[input.statusCategory];
  const titleLines = wrapTitle(input.title);
  const titleHeight = titleLines.length * 22;
  const link = input.url || null;
  const bottomY = y + 52 + titleHeight + 12;
  const height = bottomY + 28 + 14 - y;

  const skeleton: any[] = [
    {
      type: "rectangle",
      x,
      y,
      width: CARD_WIDTH,
      height,
      strokeColor: "#c1c7d0",
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
      link,
    },
    {
      type: "rectangle",
      x: x + 14,
      y: y + 14,
      width: 22,
      height: 22,
      strokeColor: type.color,
      backgroundColor: type.color,
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
      label: {
        text: type.glyph,
        fontSize: 14,
        fontFamily: 2,
        strokeColor: "#ffffff",
      },
    },
    {
      type: "text",
      x: x + 44,
      y: y + 16,
      text: input.key,
      fontSize: 16,
      fontFamily: 2,
      strokeColor: "#0c66e4",
    },
    {
      type: "text",
      x: x + 14,
      y: y + 48,
      text: titleLines.join("\n"),
      fontSize: 16,
      fontFamily: 2,
      strokeColor: "#172b4d",
    },
    {
      type: "rectangle",
      x: x + 14,
      y: bottomY,
      width: Math.max(70, input.status.length * 9 + 20),
      height: 28,
      strokeColor: status.bg,
      backgroundColor: status.bg,
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
      label: {
        text: input.status.toUpperCase(),
        fontSize: 12,
        fontFamily: 2,
        strokeColor: status.fg,
      },
    },
  ];

  if (input.assignee?.trim() && input.avatarFileId) {
    skeleton.push({
      type: "image",
      fileId: input.avatarFileId,
      status: "saved",
      x: x + CARD_WIDTH - 14 - 34,
      y: bottomY - 3,
      width: 34,
      height: 34,
    });
  } else if (input.assignee?.trim()) {
    skeleton.push({
      type: "ellipse",
      x: x + CARD_WIDTH - 14 - 34,
      y: bottomY - 3,
      width: 34,
      height: 34,
      strokeColor: "#6554c0",
      backgroundColor: "#6554c0",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
    });
    const initials = initialsOf(input.assignee);
    skeleton.push({
      type: "text",
      // ~7px per glyph at 11px Helvetica; free text avoids ellipse label wrapping
      x: x + CARD_WIDTH - 14 - 17 - (initials.length * 7) / 2,
      y: bottomY - 3 + 17 - 7,
      text: initials,
      fontSize: 11,
      fontFamily: 2,
      strokeColor: "#ffffff",
    });
  }

  const elements = convertToExcalidrawElements(skeleton, {
    regenerateIds: true,
  });
  return elements.map((el) => ({
    ...el,
    // Excalidraw keeps nested groups innermost-first; one flat group is enough.
    groupIds: [groupId, ...(el.groupIds ?? [])],
  }));
};

const GROUP_ID_RE = /^jira-([A-Z][A-Z0-9_]+-\d+)-[a-z0-9]+$/;

export const createJiraGroupId = (key: string) =>
  `jira-${key}-${Math.random().toString(36).slice(2, 10)}`;

/** The issue key is recoverable from the card's groupId, so no custom data is needed. */
export const parseJiraGroupId = (groupId: string): string | null =>
  GROUP_ID_RE.exec(groupId)?.[1] ?? null;

const MAX_REFRESH_CARDS = 20;

export type JiraAvatarFile = { fileId: string; file: any };

export type JiraRefreshResult = {
  updated: number;
  failed: number;
  elements: any[];
  files: any[];
};

/**
 * Rebuilds Jira cards in place from fresh issue data. Only touches the given
 * groupIds (selected cards, or every card), keeps each card's position, and
 * soft-deletes the old elements so collaborators sync the change.
 */
export const refreshJiraCards = async (
  sceneElements: readonly any[],
  groupIds: string[],
  loadIssue: (key: string) => Promise<{
    key: string;
    summary: string;
    issueType: JiraIssueType;
    status: string;
    statusCategory: JiraStatusCategory;
    assignee: string | null;
    assigneeAvatar?: string | null;
    url: string;
  }>,
  prepareAvatar?: (dataUrl: string) => Promise<JiraAvatarFile | null>,
): Promise<JiraRefreshResult> => {
  let elements = [...sceneElements];
  const files: any[] = [];
  let updated = 0;
  let failed = 0;
  const now = Date.now();
  for (const groupId of groupIds.slice(0, MAX_REFRESH_CARDS)) {
    const key = parseJiraGroupId(groupId);
    const members = elements.filter(
      (el) => !el.isDeleted && el.groupIds?.includes(groupId),
    );
    if (!key || members.length === 0) continue;
    let issue;
    try {
      issue = await loadIssue(key);
    } catch {
      failed += 1;
      continue;
    }
    const base = members[0];
    let avatar: JiraAvatarFile | null = null;
    if (prepareAvatar && issue.assignee && issue.assigneeAvatar) {
      avatar = await prepareAvatar(issue.assigneeAvatar);
      if (avatar) files.push(avatar.file);
    }
    const fresh = buildJiraCardElements(
      {
        key: issue.key,
        title: issue.summary || issue.key,
        url: issue.url,
        issueType: issue.issueType,
        status: issue.status,
        statusCategory: issue.statusCategory,
        assignee: issue.assignee ?? undefined,
        avatarFileId: avatar?.fileId,
      },
      { x: base.x, y: base.y },
      groupId,
    );
    const memberIds = new Set(members.map((el) => el.id));
    const insertAt = elements.findIndex((el) => memberIds.has(el.id));
    elements = elements.map((el) =>
      memberIds.has(el.id)
        ? {
            ...el,
            isDeleted: true,
            version: el.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
            updated: now,
          }
        : el,
    );
    elements.splice(insertAt, 0, ...fresh);
    updated += 1;
  }
  return { updated, failed, elements, files };
};
