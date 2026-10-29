import React from "react";
import { getElementAnchors } from "./arrowSnap";

type Props = { api: any };

/** Miro-style anchor dots on the shape an arrow end is about to bind to. */
export const ArrowAnchorOverlay: React.FC<Props> = ({ api }) => {
  const appState = api.getAppState();
  const elements: readonly any[] = api.getSceneElements();
  const suggested: any[] = appState?.suggestedBindings ?? [];
  if (!suggested.length) return null;
  const zoom = appState.zoom?.value ?? 1;
  const ids = new Set(suggested.map((s) => s?.id));
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {elements
        .filter((el) => ids.has(el.id) && !el.isDeleted)
        .flatMap((el) =>
          getElementAnchors(el).map(({ point }, i) => (
            <span
              key={`${el.id}-${i}`}
              data-testid="arrow-anchor-dot"
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#6965db] bg-white"
              style={{
                left: (point[0] + appState.scrollX) * zoom,
                top: (point[1] + appState.scrollY) * zoom,
              }}
            />
          )),
        )}
    </div>
  );
};
