import React from "react";
import { STICKY_COLORS } from "../utils/stickyNote";

interface StickyNoteMenuProps {
  selected: string;
  disabled?: boolean;
  onAdd: (color: string) => void;
}

/** Colour swatches in the main menu; clicking one drops a sticky note. */
export const StickyNoteMenu: React.FC<StickyNoteMenuProps> = ({
  selected,
  disabled,
  onAdd,
}) => (
  <div style={{ padding: "4px 8px", width: "100%" }}>
    <div style={{ fontSize: 13, marginBottom: 6 }}>
      Add sticky note <span style={{ opacity: 0.6 }}>(Shift+N)</span>
    </div>
    <div style={{ display: "flex", gap: 6 }}>
      {STICKY_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          data-testid={`sticky-color-${c.name.toLowerCase()}`}
          title={c.name}
          aria-label={`Add ${c.name} sticky note`}
          disabled={disabled}
          onClick={() => onAdd(c.value)}
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            background: c.value,
            border:
              c.value === selected
                ? "2px solid var(--color-on-surface)"
                : "1px solid rgba(0,0,0,0.25)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        />
      ))}
    </div>
  </div>
);
