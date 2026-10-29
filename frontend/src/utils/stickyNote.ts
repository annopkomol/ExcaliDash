/**
 * Miro-style sticky notes made of a single plain Excalidraw rectangle. Text is
 * typed into it afterwards, which makes Excalidraw create a standard bound
 * text element. No custom types or customData, so notes copy-paste into
 * excalidraw.com unchanged.
 */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

export const STICKY_SIZE = 200;

export const STICKY_COLORS = [
  { name: "Yellow", value: "#fff599" },
  { name: "Orange", value: "#ffcd8f" },
  { name: "Pink", value: "#ffb3d1" },
  { name: "Green", value: "#c4f0a4" },
  { name: "Blue", value: "#a8dcff" },
  { name: "Purple", value: "#d9c2ff" },
] as const;

export const DEFAULT_STICKY_COLOR = STICKY_COLORS[0].value;

/** Text defaults applied so the typed note text is centred and readable. */
export const STICKY_TEXT_STATE = {
  currentItemFontFamily: 2,
  currentItemFontSize: 24,
  currentItemTextAlign: "center",
  currentItemStrokeColor: "#1e1e1e",
} as const;

export const buildStickyNote = (
  center: { x: number; y: number },
  color: string = DEFAULT_STICKY_COLOR,
) =>
  convertToExcalidrawElements([
    {
      type: "rectangle",
      x: center.x - STICKY_SIZE / 2,
      y: center.y - STICKY_SIZE / 2,
      width: STICKY_SIZE,
      height: STICKY_SIZE,
      backgroundColor: color,
      fillStyle: "solid",
      strokeColor: "transparent",
      strokeWidth: 1,
      roughness: 0,
      roundness: null,
      opacity: 100,
    },
  ]);
