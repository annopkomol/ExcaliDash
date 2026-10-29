import React from "react";
import { findMagnetTarget, type MagnetHit } from "./arrowSnap";

/** How far outside a shape (in screen px) an arrow end is still pulled onto it. */
const MAGNET_MARGIN_PX = 24;
/** How close (in screen px) a press must be to an arrow end to count as dragging it. */
const ENDPOINT_GRAB_PX = 14;

export type MagnetPreview = { elementId: string; side: number | null } | null;

type Mode =
  | { kind: "create"; excludeIds: Set<string> }
  | { kind: "endpoint"; excludeIds: Set<string> };

const synthetic = new WeakSet<Event>();

const toScene = (
  appState: any,
  clientX: number,
  clientY: number,
): [number, number] => {
  const zoom = appState.zoom?.value ?? 1;
  return [
    (clientX - appState.offsetLeft) / zoom - appState.scrollX,
    (clientY - appState.offsetTop) / zoom - appState.scrollY,
  ];
};

const toClient = (
  appState: any,
  [x, y]: [number, number],
): [number, number] => {
  const zoom = appState.zoom?.value ?? 1;
  return [
    (x + appState.scrollX) * zoom + appState.offsetLeft,
    (y + appState.scrollY) * zoom + appState.offsetTop,
  ];
};

/** Re-dispatch a pointer event at other coordinates, hiding the original from Excalidraw. */
const redirect = (event: PointerEvent, clientX: number, clientY: number) => {
  event.stopImmediatePropagation();
  const clone = new PointerEvent(event.type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: event.detail,
    clientX,
    clientY,
    screenX: event.screenX + (clientX - event.clientX),
    screenY: event.screenY + (clientY - event.clientY),
    button: event.button,
    buttons: event.buttons,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    pressure: event.pressure,
    width: event.width,
    height: event.height,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  });
  synthetic.add(clone);
  (event.target ?? window).dispatchEvent(clone);
};

const isOnCanvas = (target: EventTarget | null) =>
  target instanceof HTMLCanvasElement && !!target.closest(".excalidraw");

/**
 * Miro-style magnet for arrow ends: while drawing an arrow, or dragging the
 * end of a selected one, the pointer is pulled onto the nearest side-midpoint
 * anchor of the shape under (or near) it, so Excalidraw binds right there.
 * Hold Ctrl/Cmd to place the end freely, as Excalidraw does for binding.
 */
export const useArrowMagnet = (api: any, enabled: boolean): MagnetPreview => {
  const [preview, setPreview] = React.useState<MagnetPreview>(null);

  React.useEffect(() => {
    if (!api || !enabled) {
      setPreview(null);
      return;
    }
    let mode: Mode | null = null;

    const show = (next: MagnetPreview) =>
      setPreview((prev) =>
        prev?.elementId === next?.elementId && prev?.side === next?.side
          ? prev
          : next,
      );

    const hitAt = (
      event: PointerEvent,
      excludeIds?: Set<string>,
    ): MagnetHit | null => {
      const appState = api.getAppState();
      const zoom = appState.zoom?.value ?? 1;
      return findMagnetTarget(
        api.getSceneElements(),
        toScene(appState, event.clientX, event.clientY),
        MAGNET_MARGIN_PX / zoom,
        { excludeIds, editingGroupId: appState.editingGroupId },
      );
    };

    const snapTo = (event: PointerEvent, hit: MagnetHit) => {
      const [x, y] = toClient(api.getAppState(), hit.target);
      if (Math.hypot(x - event.clientX, y - event.clientY) > 0.5)
        redirect(event, x, y);
    };

    const isArrowTool = (appState: any) =>
      appState.activeTool?.type === "arrow" &&
      appState.currentItemArrowType !== "elbow";

    // Pressing near an end of the single selected (non-elbow) arrow starts dragging that end.
    const grabbedEndpoint = (
      event: PointerEvent,
      appState: any,
    ): Mode | null => {
      const ids = Object.keys(appState.selectedElementIds ?? {}).filter(
        (id) => appState.selectedElementIds[id],
      );
      if (ids.length !== 1) return null;
      const arrow = api.getSceneElements().find((el: any) => el.id === ids[0]);
      if (
        arrow?.type !== "arrow" ||
        arrow.elbowed ||
        !arrow.points?.length ||
        // Without the point handles Excalidraw drags the whole arrow instead.
        appState.selectedLinearElement?.elementId !== arrow.id
      )
        return null;
      const ends = [
        { point: arrow.points[0], other: arrow.endBinding },
        {
          point: arrow.points[arrow.points.length - 1],
          other: arrow.startBinding,
        },
      ];
      for (const { point, other } of ends) {
        const [cx, cy] = toClient(appState, [
          arrow.x + point[0],
          arrow.y + point[1],
        ]);
        if (
          Math.hypot(cx - event.clientX, cy - event.clientY) <= ENDPOINT_GRAB_PX
        ) {
          return {
            kind: "endpoint",
            excludeIds: new Set(other?.elementId ? [other.elementId] : []),
          };
        }
      }
      return null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (
        synthetic.has(event) ||
        !isOnCanvas(event.target) ||
        event.button !== 0
      )
        return;
      const appState = api.getAppState();
      if (appState.viewModeEnabled) return;
      if (isArrowTool(appState)) {
        const hit = event.ctrlKey || event.metaKey ? null : hitAt(event);
        // A click that continues a click-by-click arrow may end on the start shape.
        const excludeIds = new Set<string>(
          hit && !appState.multiElement ? [hit.element.id] : [],
        );
        mode = { kind: "create", excludeIds };
        if (hit) snapTo(event, hit);
        return;
      }
      mode = grabbedEndpoint(event, appState);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (synthetic.has(event)) return;
      const appState = api.getAppState();
      const active = mode && event.buttons & 1;
      if (!active && !(isArrowTool(appState) && isOnCanvas(event.target))) {
        show(null);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        show(null);
        return;
      }
      const hit = hitAt(event, active ? mode!.excludeIds : undefined);
      show(hit ? { elementId: hit.element.id, side: hit.side } : null);
      if (hit && (active || appState.multiElement)) snapTo(event, hit);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (synthetic.has(event)) return;
      const current = mode;
      mode = null;
      show(null);
      if (!current || event.ctrlKey || event.metaKey) return;
      const hit = hitAt(event, current.excludeIds);
      if (hit) snapTo(event, hit);
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
    };
  }, [api, enabled]);

  return preview;
};
