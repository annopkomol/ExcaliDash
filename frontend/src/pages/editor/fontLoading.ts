import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import { DEFAULT_ITEM_STYLE } from "./shared";

// Excalidraw registers its FontFaces under these names. Only the fonts it does
// not load up front need listing; others fall back to document.fonts.ready.
const FONT_FACE_NAMES: Record<number, string> = {
  6: "Nunito",
  7: "Lilita One",
  8: "Comic Shanns",
  9: "Liberation Sans",
};

// Ignore sub-pixel measurement noise so opening a drawing on another browser
// doesn't rewrite every text element.
const WIDTH_TOLERANCE_PX = 1;

// Excalidraw adds its FontFaces to document.fonts only once its own scene-font
// loading starts, which can be after the API callback; loading before then
// silently matches nothing.
const FACE_REGISTRATION_TIMEOUT_MS = 5000;

const waitForFontFace = async (name: string) => {
  const deadline = Date.now() + FACE_REGISTRATION_TIMEOUT_MS;
  while (![...document.fonts].some((face) => face.family === name)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
};

const loadFontFamily = async (fontFamily: unknown) => {
  const name =
    typeof fontFamily === "number" ? FONT_FACE_NAMES[fontFamily] : undefined;
  if (!name || !(await waitForFontFace(name))) return;
  await document.fonts.load(`20px "${name}"`).catch(() => undefined);
};

/**
 * Excalidraw measures a new text element with whatever font is loaded at that
 * moment and only re-renders (never re-measures) once the real font arrives.
 * With Nunito as the default it isn't loaded until first used, so text typed
 * right after opening a drawing was sized with the fallback font and its last
 * characters got clipped. Load the current/default font up front, then widen
 * any text element (including ones saved clipped earlier) whose stored box is
 * narrower than its text.
 */
export const ensureEditorFontsLoaded = async (api: any) => {
  // The API callback can fire before initialData is applied, when appState
  // still holds Excalidraw's own default font, so always include ours.
  const elements: readonly any[] =
    api.getSceneElementsIncludingDeleted?.() ?? [];
  const families = new Set<unknown>([
    DEFAULT_ITEM_STYLE.currentItemFontFamily,
    api.getAppState?.()?.currentItemFontFamily,
    ...elements.filter(isLiveText).map((el) => el.fontFamily),
  ]);
  await Promise.all([...families].map(loadFontFamily));
  await document.fonts.ready;

  const current: readonly any[] =
    api.getSceneElementsIncludingDeleted?.() ?? [];
  if (!current.some(isLiveText)) return;
  // Excalidraw 0.18 only honours refreshDimensions together with
  // repairBindings; it works on copies, and only text widths are taken back.
  // The whole scene is passed so bound text can find its container.
  const refreshed = restoreElements(current as any, null, {
    repairBindings: true,
    refreshDimensions: true,
  }) as any[];
  const refreshedById = new Map(refreshed.map((el) => [el.id, el]));
  const fixes = new Map<string, any>();
  current.filter(isLiveText).forEach((prev) => {
    const next = refreshedById.get(prev.id);
    if (next && next.width > prev.width + WIDTH_TOLERANCE_PX) {
      fixes.set(prev.id, {
        ...prev,
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
        version: (prev.version ?? 0) + 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        updated: Date.now(),
      });
    }
  });
  if (fixes.size === 0) return;
  api.updateScene({
    elements: current.map((el) => fixes.get(el.id) ?? el),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};

const isLiveText = (el: any) => el?.type === "text" && !el.isDeleted;
