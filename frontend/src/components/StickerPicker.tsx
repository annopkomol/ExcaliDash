import React from "react";
import { STICKERS, stickerDataUrl, type Sticker } from "../utils/stickers";

interface StickerPickerProps {
  disabled?: boolean;
  onAdd: (sticker: Sticker) => void;
}

/** Grid of bundled stickers in the main menu; click one to drop it on the canvas. */
export const StickerPicker: React.FC<StickerPickerProps> = ({
  disabled,
  onAdd,
}) => (
  <div style={{ padding: "4px 8px", width: "100%" }}>
    <div style={{ fontSize: 13, marginBottom: 6 }}>Add sticker</div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gap: 2,
        maxHeight: 132,
        overflowY: "auto",
      }}
    >
      {STICKERS.map((s) => (
        <button
          key={s.name}
          type="button"
          data-testid={`sticker-${s.name}`}
          title={s.name.replace(/-/g, " ")}
          aria-label={`Add ${s.name.replace(/-/g, " ")} sticker`}
          disabled={disabled}
          onClick={() => onAdd(s)}
          style={{
            width: 28,
            height: 28,
            padding: 2,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <img
            src={stickerDataUrl(s.svg)}
            alt=""
            width={24}
            height={24}
            draggable={false}
          />
        </button>
      ))}
    </div>
  </div>
);
