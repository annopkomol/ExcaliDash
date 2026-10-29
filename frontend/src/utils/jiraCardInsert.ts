import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  buildJiraCardElements,
  createJiraGroupId,
  type JiraAvatarFile,
  type JiraCardInput,
} from "./jiraCard";

const AVATAR_PX = 96;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const sha1Hex = async (text: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};

/**
 * Crops the avatar to a circle on a transparent PNG so it works as a plain
 * Excalidraw image element (standard files entry, no custom data).
 * Returns null when the picture cannot be decoded; callers fall back to initials.
 */
export const prepareAvatar = async (
  dataUrl: string,
): Promise<JiraAvatarFile | null> => {
  try {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.beginPath();
    ctx.arc(AVATAR_PX / 2, AVATAR_PX / 2, AVATAR_PX / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, 0, 0, AVATAR_PX, AVATAR_PX);
    const cropped = canvas.toDataURL("image/png");
    const fileId = await sha1Hex(cropped);
    return {
      fileId,
      file: {
        id: fileId,
        mimeType: "image/png",
        dataURL: cropped,
        created: Date.now(),
      },
    };
  } catch {
    return null;
  }
};

/** Adds a Jira card (and its avatar file, if any) to the scene and selects it. */
export const insertJiraCard = async (
  api: any,
  input: JiraCardInput,
  origin: { x: number; y: number },
  avatarDataUrl?: string | null,
) => {
  const avatar =
    avatarDataUrl && input.assignee ? await prepareAvatar(avatarDataUrl) : null;
  if (avatar) api.addFiles([avatar.file]);
  const groupId = createJiraGroupId(input.key);
  const elements = buildJiraCardElements(
    { ...input, avatarFileId: avatar?.fileId },
    origin,
    groupId,
  );
  api.updateScene({
    elements: [...api.getSceneElements(), ...elements],
    appState: {
      selectedElementIds: Object.fromEntries(
        elements.map((el: any) => [el.id, true]),
      ),
      selectedGroupIds: { [groupId]: true },
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};
