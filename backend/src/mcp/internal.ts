import crypto from "crypto";

// The MCP tools call the backend's own HTTP API over loopback so every drawing
// route keeps enforcing its validation, sharing rules and realtime broadcast.
// Those calls carry this per-process secret to skip the browser-only CSRF
// check; the caller's own Authorization header is still forwarded and checked.
export const MCP_INTERNAL_HEADER = "x-excalidash-mcp-internal";
export const mcpInternalSecret = crypto.randomBytes(32).toString("hex");

export const isInternalMcpRequest = (req: {
  headers: Record<string, unknown>;
}): boolean => {
  const provided = req.headers[MCP_INTERNAL_HEADER];
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(mcpInternalSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
