import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcrypt";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";
import { getTestPrisma, setupTestDb } from "./testUtils";
import { startRuntimeServer } from "./runtimeServer";
import { config } from "../config";
import { buildElements } from "../mcp/elements";

const parse = (result: any) => JSON.parse(result.content[0].text);

describe("MCP endpoint", () => {
  let server: Awaited<ReturnType<typeof startRuntimeServer>>;
  let token: string;
  let client: Client;

  beforeAll(async () => {
    setupTestDb();
    const prisma = getTestPrisma();
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true, authOnboardingCompleted: true },
      create: {
        id: "default",
        authEnabled: true,
        authOnboardingCompleted: true,
      },
    });
    const user = await prisma.user.create({
      data: {
        email: "mcp-user@test.local",
        passwordHash: await bcrypt.hash("password123", 10),
        name: "MCP User",
        role: "USER",
        isActive: true,
      },
    });
    const generated = generateApiKey();
    await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: "mcp",
        keyId: generated.keyId,
        tokenHash: generated.tokenHash,
        prefix: generated.prefix,
        scopes: serializeApiKeyScopes(),
      },
    });
    token = generated.token;
    server = await startRuntimeServer({
      NODE_ENV: "development",
      API_KEY_HASH_PEPPER: config.apiKeyHashPepper,
      ENFORCE_HTTPS_REDIRECT: "false",
    });
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
  }, 60000);

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  it("rejects unauthenticated and bad-key requests", async () => {
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "x", version: "1" },
      },
    };
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const anon = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(init),
    });
    expect(anon.status).toBe(401);
    const bad = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { ...headers, Authorization: "Bearer exd_nope_nope" },
      body: JSON.stringify(init),
    });
    expect(bad.status).toBe(401);
  });

  it("lists the drawing tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "list_drawings",
        "get_drawing",
        "create_drawing",
        "add_elements",
        "update_elements",
        "delete_elements",
      ]),
    );
  });

  it("creates, edits and reads a drawing with standard elements", async () => {
    const created = parse(
      await client.callTool({
        name: "create_drawing",
        arguments: {
          name: "MCP flow",
          elements: [
            {
              type: "rectangle",
              id: "a",
              x: 0,
              y: 0,
              label: { text: "Start" },
            },
            {
              type: "rectangle",
              id: "b",
              x: 300,
              y: 0,
              label: { text: "End" },
            },
            { type: "arrow", from: "a", to: "b" },
          ],
        },
      }),
    );
    const id = created.id;
    expect(id).toBeTruthy();

    const added = await client.callTool({
      name: "add_elements",
      arguments: {
        id,
        elements: [
          {
            type: "ellipse",
            id: "c",
            x: 150,
            y: 200,
            label: { text: "Maybe" },
          },
          { type: "arrow", from: "a", to: "c" },
        ],
      },
    });
    expect(added.isError).toBeFalsy();

    const updated = await client.callTool({
      name: "update_elements",
      arguments: {
        id,
        updates: [
          { id: "a", set: { backgroundColor: "#a5d8ff", text: "Begin" } },
        ],
      },
    });
    expect(updated.isError).toBeFalsy();

    const del = await client.callTool({
      name: "delete_elements",
      arguments: { id, elementIds: ["c"] },
    });
    expect(del.isError).toBeFalsy();

    const summary = parse(
      await client.callTool({ name: "get_drawing", arguments: { id } }),
    );
    const byId = Object.fromEntries(
      summary.elements.map((e: any) => [e.id, e]),
    );
    expect(byId.a.label).toBe("Begin");
    expect(byId.a.bg).toBe("#a5d8ff");
    expect(byId.c).toBeUndefined();
    // The a->c arrow went away with its shape; a->b remains.
    expect(
      summary.elements.filter((e: any) => e.type === "arrow"),
    ).toHaveLength(1);

    const full = parse(
      await client.callTool({
        name: "get_drawing",
        arguments: { id, format: "excalidraw" },
      }),
    );
    expect(full.type).toBe("excalidraw");
    expect(full.version).toBe(2);
    // No arrow is left pointing at the deleted shape.
    const dangling = full.elements.filter(
      (e: any) => !e.isDeleted && e.endBinding?.elementId === "c",
    );
    expect(dangling).toHaveLength(0);

    const list = parse(
      await client.callTool({
        name: "list_drawings",
        arguments: { search: "MCP flow" },
      }),
    );
    expect(list.drawings.some((d: any) => d.id === id)).toBe(true);
  });

  it("reports unknown element ids as tool errors", async () => {
    const created = parse(
      await client.callTool({
        name: "create_drawing",
        arguments: { name: "empty" },
      }),
    );
    const res = await client.callTool({
      name: "update_elements",
      arguments: { id: created.id, updates: [{ id: "ghost", set: { x: 1 } }] },
    });
    expect(res.isError).toBe(true);
  });
});

describe("buildElements", () => {
  it("produces standard bound text and arrow bindings", () => {
    const { created } = buildElements([
      {
        type: "rectangle",
        id: "r",
        x: 0,
        y: 0,
        width: 200,
        height: 80,
        label: { text: "Hi" },
      },
      { type: "ellipse", id: "e", x: 400, y: 0, width: 120, height: 80 },
      { type: "arrow", from: "r", to: "e" },
    ]);
    const rect = created.find((e) => e.id === "r")!;
    const label = created.find((e) => e.type === "text")!;
    const arrow = created.find((e) => e.type === "arrow")!;
    expect(label.containerId).toBe("r");
    expect(rect.boundElements).toEqual(
      expect.arrayContaining([
        { id: label.id, type: "text" },
        { id: arrow.id, type: "arrow" },
      ]),
    );
    expect(arrow.startBinding.elementId).toBe("r");
    expect(arrow.endBinding.elementId).toBe("e");
    expect(arrow.x).toBeCloseTo(200, 0);
    expect(arrow.points[1][0]).toBeCloseTo(200, 0);
  });
});
