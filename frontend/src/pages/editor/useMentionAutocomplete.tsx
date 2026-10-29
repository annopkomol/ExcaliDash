import React from "react";
import { getMentionableUsers } from "../../api";
import { filterMentionNames, findMentionToken } from "./mentionToken";

type MenuState = {
  names: string[];
  index: number;
  left: number;
  top: number;
};

const WYSIWYG_SELECTOR = "textarea.excalidraw-wysiwyg";

/**
 * "@" autocomplete while editing an Excalidraw text element. The chosen name is
 * inserted as plain text ("@Name"), so the stored scene stays standard Excalidraw.
 */
export const useMentionAutocomplete = (params: {
  containerRef: React.RefObject<HTMLElement>;
  drawingId?: string;
  enabled: boolean;
  extraNames: readonly string[];
}) => {
  const { containerRef, drawingId, enabled, extraNames } = params;
  const [fetched, setFetched] = React.useState<string[]>([]);
  const [menu, setMenu] = React.useState<MenuState | null>(null);
  const namesRef = React.useRef<string[]>([]);
  const menuRef = React.useRef<MenuState | null>(null);
  menuRef.current = menu;

  React.useEffect(() => {
    if (!drawingId || !enabled) return;
    let cancelled = false;
    getMentionableUsers(drawingId)
      .then((users) => {
        if (!cancelled) setFetched(users.map((u) => u.name));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [drawingId, enabled]);

  const extraKey = extraNames.join("\u0000");
  React.useEffect(() => {
    const seen = new Set<string>();
    namesRef.current = [...fetched, ...extraNames].filter((n) => {
      const key = n.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, extraKey]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const isEditor = (t: EventTarget | null): t is HTMLTextAreaElement =>
      t instanceof HTMLTextAreaElement && t.matches(WYSIWYG_SELECTOR);

    const update = (ta: HTMLTextAreaElement) => {
      const token = findMentionToken(ta.value, ta.selectionStart ?? 0);
      const names = token
        ? filterMentionNames(namesRef.current, token.query)
        : [];
      if (!token || names.length === 0) {
        setMenu(null);
        return;
      }
      const rect = ta.getBoundingClientRect();
      const box = container.getBoundingClientRect();
      setMenu((prev) => ({
        names,
        index: Math.min(prev?.index ?? 0, names.length - 1),
        left: rect.left - box.left,
        top: rect.bottom - box.top + 4,
      }));
    };

    const insert = (ta: HTMLTextAreaElement, name: string) => {
      const token = findMentionToken(ta.value, ta.selectionStart ?? 0);
      if (!token) return;
      ta.setRangeText(`@${name} `, token.start, token.end, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      setMenu(null);
    };

    const onInput = (e: Event) => {
      if (isEditor(e.target)) update(e.target);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const current = menuRef.current;
      if (!current || !isEditor(e.target)) return;
      const swallow = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        swallow();
        const step = e.key === "ArrowDown" ? 1 : -1;
        const n = current.names.length;
        setMenu({ ...current, index: (current.index + step + n) % n });
      } else if (e.key === "Enter" || e.key === "Tab") {
        swallow();
        insert(e.target, current.names[current.index]);
      } else if (e.key === "Escape") {
        swallow();
        setMenu(null);
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      if (isEditor(e.target)) setMenu(null);
    };
    const onPick = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      const ta = container.querySelector<HTMLTextAreaElement>(WYSIWYG_SELECTOR);
      if (ta && detail) {
        insert(ta, detail);
        ta.focus();
      }
    };

    container.addEventListener("input", onInput, true);
    container.addEventListener("keydown", onKeyDown, true);
    container.addEventListener("focusout", onFocusOut, true);
    container.addEventListener("mention-pick", onPick);
    return () => {
      container.removeEventListener("input", onInput, true);
      container.removeEventListener("keydown", onKeyDown, true);
      container.removeEventListener("focusout", onFocusOut, true);
      container.removeEventListener("mention-pick", onPick);
    };
  }, [containerRef, enabled]);

  const menuElement = menu ? (
    <ul
      role="listbox"
      data-testid="mention-menu"
      className="absolute z-[30] min-w-[10rem] max-w-[16rem] overflow-hidden rounded-lg border border-slate-300 bg-white py-1 text-sm shadow-lg dark:border-neutral-600 dark:bg-neutral-800"
      style={{ left: menu.left, top: menu.top }}
    >
      {menu.names.map((name, i) => (
        <li
          key={name}
          role="option"
          aria-selected={i === menu.index}
          className={
            "cursor-pointer truncate px-3 py-1.5 text-slate-800 dark:text-neutral-100 " +
            (i === menu.index
              ? "bg-indigo-100 dark:bg-indigo-900/50"
              : "hover:bg-slate-100 dark:hover:bg-neutral-700")
          }
          // mousedown (not click) so the text editor keeps focus
          onMouseDown={(e) => {
            e.preventDefault();
            containerRef.current?.dispatchEvent(
              new CustomEvent("mention-pick", { detail: name }),
            );
          }}
        >
          @{name}
        </li>
      ))}
    </ul>
  ) : null;

  return menuElement;
};
