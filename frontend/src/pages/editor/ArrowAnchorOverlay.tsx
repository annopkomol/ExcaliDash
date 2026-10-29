import React from "react";
import { getElementAnchors } from "./arrowSnap";
import type { MagnetPreview } from "./useArrowMagnet";

type Props = { api: any; preview: NonNullable<MagnetPreview> };

/** Miro-style anchor dots on the shape an arrow end is snapping to. */
export const ArrowAnchorOverlay: React.FC<Props> = ({ api, preview }) => {
  const appState = api.getAppState();
  const element = api
    .getSceneElements()
    .find((el: any) => el.id === preview.elementId && !el.isDeleted);
  if (!element) return null;
  const zoom = appState.zoom?.value ?? 1;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {getElementAnchors(element).map(({ point }, i) => (
        <span
          key={i}
          data-testid="arrow-anchor-dot"
          data-active={i === preview.side ? "true" : undefined}
          className={
            i === preview.side
              ? "absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#6965db] shadow"
              : "absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#6965db] bg-white"
          }
          style={{
            left: (point[0] + appState.scrollX) * zoom,
            top: (point[1] + appState.scrollY) * zoom,
          }}
        />
      ))}
    </div>
  );
};
