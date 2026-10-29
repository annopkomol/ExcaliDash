import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "../config";
import { authModeService } from "../middleware/auth";
import { createMcpServer, type BackendApi } from "./server";
import { MCP_INTERNAL_HEADER, mcpInternalSecret } from "./internal";

const loopbackBaseUrl = (): string => {
  const host = config.listenHost;
  const target =
    !host || host === "0.0.0.0" || host === "::" || host === "[::]"
      ? "127.0.0.1"
      : host.includes(":") && !host.startsWith("[")
        ? `[${host}]`
        : host;
  return `http://${target}:${config.port}`;
};

const hasBearer = (header: unknown): header is string =>
  typeof header === "string" && /^Bearer\s+\S+/i.test(header);

const jsonRpcError = (
  res: express.Response,
  status: number,
  code: number,
  message: string,
) =>
  res
    .status(status)
    .json({ jsonrpc: "2.0", error: { code, message }, id: null });

// Streamable HTTP endpoint for MCP clients (Claude Code, Claude Desktop, ...).
// Stateless: each request gets its own server instance, authenticated with the
// same API keys as the REST API (Authorization: Bearer exd_...).
export const registerMcpRoutes = (app: express.Express) => {
  if (!config.mcpEnabled) return;

  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.setHeader("Allow", "POST");
    return jsonRpcError(res, 405, -32000, "Method not allowed. Use POST.");
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.post("/mcp", async (req, res) => {
    try {
      const authorization = req.headers.authorization;
      const authEnabled = await authModeService.getAuthEnabled();
      if (authEnabled && !hasBearer(authorization)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="excalidash"');
        return jsonRpcError(
          res,
          401,
          -32001,
          "Authentication required: send an ExcaliDash API key as 'Authorization: Bearer exd_...'.",
        );
      }

      const baseUrl = loopbackBaseUrl();
      const api: BackendApi = async (method, path, body) => {
        const headers: Record<string, string> = {
          [MCP_INTERNAL_HEADER]: mcpInternalSecret,
          // Loopback hop: never bounce through the HTTPS redirect.
          "X-Forwarded-Proto": "https",
        };
        if (hasBearer(authorization)) headers.Authorization = authorization;
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const raw = await response.text();
        let parsed: unknown = raw;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          // keep raw text
        }
        return { status: response.status, body: parsed };
      };

      // Reject a bad key at the handshake instead of on every tool call.
      if (authEnabled && req.body?.method === "initialize") {
        const probe = await api("GET", "/collections");
        if (probe.status === 401 || probe.status === 403) {
          res.setHeader("WWW-Authenticate", 'Bearer realm="excalidash"');
          return jsonRpcError(
            res,
            401,
            -32001,
            "Invalid or revoked API key, or key lacks the collections:read scope.",
          );
        }
      }

      const server = createMcpServer(api);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp] request failed:", error);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });
};
