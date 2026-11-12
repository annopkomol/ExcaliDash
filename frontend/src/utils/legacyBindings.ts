/**
 * Excalidraw migrates pre-`mode` arrow bindings (focus/gap) on load and logs
 * "[NONDELETED][INVARIANT] Restoring a deleted element" when the arrow is
 * deleted. A deleted arrow's bindings never render or bind anything, so drop
 * the legacy ones before handing the scene to the editor. Everything else,
 * and the caller's own copy of the scene, is left untouched.
 */
export const dropLegacyBindingsOnDeletedArrows = <T extends Record<string, any>>(
  elements: readonly T[],
): readonly T[] => {
  let changed = false;
  const next = elements.map((el) => {
    if (!el?.isDeleted || el.type !== "arrow") return el;
    const legacy = (b: any) => b && b.elementId && !b.mode;
    if (!legacy(el.startBinding) && !legacy(el.endBinding)) return el;
    changed = true;
    return {
      ...el,
      startBinding: legacy(el.startBinding) ? null : el.startBinding,
      endBinding: legacy(el.endBinding) ? null : el.endBinding,
    };
  });
  return changed ? next : elements;
};
