export type MentionToken = { start: number; end: number; query: string };

/**
 * Finds an in-progress "@query" right before the caret. The "@" must start the
 * text or follow whitespace so emails like a@b.com do not trigger it.
 */
export const findMentionToken = (
  text: string,
  caret: number,
): MentionToken | null => {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,40})$/u.exec(before);
  if (!match) return null;
  const start = caret - match[2].length - 1;
  return { start, end: caret, query: match[2] };
};

export const filterMentionNames = (
  names: readonly string[],
  query: string,
  limit = 6,
): string[] => {
  const q = query.toLowerCase();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) starts.push(name);
    else if (q && lower.includes(q)) contains.push(name);
  }
  return [...starts, ...contains].slice(0, limit);
};
