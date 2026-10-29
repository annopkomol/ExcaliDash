import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildElements,
  deleteElements,
  patchElement,
  type ExcalidrawElement,
  type Skeleton,
} from "./elements";

export type BackendApi = (
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: any }>;

const INSTRUCTIONS = `ExcaliDash drawings are standard Excalidraw scenes. Everything you create here can be copy-pasted into excalidraw.com.

Workflow: list_drawings or create_drawing, then add_elements / update_elements / delete_elements. Call get_drawing (summary) first to see what is already on the canvas before editing, and place new elements so they do not overlap existing ones.

Coordinates: x grows right, y grows down, units are pixels. A 160x60 rectangle with a label fits ~20 characters at the default 20px font. Leave 40-80px between connected shapes. Prefer 'label' on shapes over separate text elements, and 'from'/'to' on arrows so they stay attached when shapes move.
Colours: strokeColor/backgroundColor accept hex. Soft fills read well: #a5d8ff blue, #b2f2bb green, #ffec99 yellow, #ffc9c9 red, #d0bfff purple, on strokeColor #1e1e1e.`;

const skeletonSchema = z.object({
  type: z.enum(["rectangle", "ellipse", "diamond", "text", "arrow", "line"]),
  id: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe("Optional stable id so later arrows/edits can reference it"),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  text: z.string().max(5000).optional().describe("Content of a `text` element"),
  label: z
    .object({
      text: z.string().max(5000),
      fontSize: z.number().optional(),
      strokeColor: z.string().optional(),
    })
    .optional()
    .describe(
      "Text centred inside a shape (or on an arrow). Shape is auto-sized if width/height are omitted",
    ),
  fontSize: z.number().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  strokeColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  fillStyle: z.enum(["solid", "hachure", "cross-hatch", "zigzag"]).optional(),
  strokeWidth: z.number().optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  roughness: z.number().min(0).max(2).optional(),
  opacity: z.number().min(0).max(100).optional(),
  rounded: z.boolean().optional(),
  from: z
    .string()
    .optional()
    .describe("Arrow start: id of an existing or newly created shape"),
  to: z
    .string()
    .optional()
    .describe("Arrow end: id of an existing or newly created shape"),
  points: z
    .array(z.tuple([z.number(), z.number()]))
    .optional()
    .describe("Arrow/line path as [x,y] pairs when not using from/to"),
  startArrowhead: z.string().nullable().optional(),
  endArrowhead: z.string().nullable().optional(),
});

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const fail = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message }],
});

const errorMessage = (res: { status: number; body: any }): string => {
  const detail =
    res.body?.message || res.body?.error || JSON.stringify(res.body);
  if (res.status === 401) return `Not authenticated: ${detail}`;
  if (res.status === 403) return `Not allowed: ${detail}`;
  if (res.status === 404) return `Not found: ${detail}`;
  return `Request failed (${res.status}): ${detail}`;
};

// Compact, token-cheap view of a scene for the model.
export const summarizeElements = (elements: ExcalidrawElement[]) => {
  const live = elements.filter((e) => !e.isDeleted);
  const labelOf = new Map<string, string>();
  for (const e of live) {
    if (e.type === "text" && e.containerId) {
      labelOf.set(e.containerId, e.originalText ?? e.text);
    }
  }
  return live
    .filter((e) => !(e.type === "text" && e.containerId))
    .map((e) => {
      const out: Record<string, unknown> = {
        id: e.id,
        type: e.type,
        x: Math.round(e.x),
        y: Math.round(e.y),
        w: Math.round(e.width),
        h: Math.round(e.height),
      };
      if (e.type === "text") out.text = e.originalText ?? e.text;
      const label = labelOf.get(e.id);
      if (label) out.label = label;
      if (e.startBinding?.elementId) out.from = e.startBinding.elementId;
      if (e.endBinding?.elementId) out.to = e.endBinding.elementId;
      if (e.backgroundColor && e.backgroundColor !== "transparent")
        out.bg = e.backgroundColor;
      if (e.strokeColor && e.strokeColor !== "#1e1e1e")
        out.stroke = e.strokeColor;
      if (e.type === "image") out.fileId = e.fileId;
      return out;
    });
};

export const createMcpServer = (api: BackendApi): McpServer => {
  const server = new McpServer(
    { name: "excalidash", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );

  const loadDrawing = async (id: string) => {
    const res = await api("GET", `/drawings/${encodeURIComponent(id)}`);
    if (res.status !== 200) throw new Error(errorMessage(res));
    return res.body;
  };

  // Read-modify-write with the drawing's version so a concurrent browser save
  // is never silently overwritten; retried a few times on conflict.
  const mutateScene = async <T>(
    id: string,
    mutate: (elements: ExcalidrawElement[]) => T,
  ): Promise<{ result: T; version: number }> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const drawing = await loadDrawing(id);
      if (drawing.accessLevel === "view")
        throw new Error("Not allowed: this drawing is view-only");
      const elements: ExcalidrawElement[] = drawing.elements ?? [];
      const result = mutate(elements);
      const res = await api("PUT", `/drawings/${encodeURIComponent(id)}`, {
        elements,
        version: drawing.version,
        // The stored thumbnail no longer matches; the editor regenerates it.
        preview: null,
      });
      if (res.status === 200) return { result, version: res.body.version };
      if (res.status !== 409) throw new Error(errorMessage(res));
    }
    throw new Error(
      "The drawing keeps changing underneath us (concurrent edits). Try again.",
    );
  };

  server.registerTool(
    "list_collections",
    {
      description: "List the user's collections (folders) of drawings.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const res = await api("GET", "/collections");
      if (res.status !== 200) return fail(errorMessage(res));
      const list = Array.isArray(res.body)
        ? res.body
        : (res.body.collections ?? []);
      return text(
        list.map((c: any) => ({
          id: c.id,
          name: c.name,
          shared: Boolean(c.isShared || c.sharedRole),
        })),
      );
    },
  );

  server.registerTool(
    "list_drawings",
    {
      description:
        "List or search drawings (newest first). Returns id, name, collection and last update; use get_drawing for contents.",
      inputSchema: {
        search: z.string().optional().describe("Substring of the drawing name"),
        collectionId: z
          .string()
          .optional()
          .describe('Collection id, "null" for unfiled, or "trash"'),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ search, collectionId, limit, offset }) => {
      const query = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (search) query.set("search", search);
      if (collectionId) query.set("collectionId", collectionId);
      const res = await api("GET", `/drawings?${query}`);
      if (res.status !== 200) return fail(errorMessage(res));
      return text({
        total: res.body.totalCount,
        drawings: res.body.drawings.map((d: any) => ({
          id: d.id,
          name: d.name,
          collectionId: d.collectionId,
          updatedAt: d.updatedAt,
          path: `/editor/${d.id}`,
        })),
      });
    },
  );

  server.registerTool(
    "get_drawing",
    {
      description:
        'Read a drawing. format "summary" (default) lists elements compactly (id, type, position, size, label, arrow endpoints) and is what you want before editing. format "excalidraw" returns the full standard .excalidraw JSON (embedded image data omitted).',
      inputSchema: {
        id: z.string(),
        format: z.enum(["summary", "excalidraw"]).default("summary"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, format }) => {
      try {
        const d = await loadDrawing(id);
        if (format === "excalidraw") {
          const files = Object.fromEntries(
            Object.entries(d.files ?? {}).map(([k, v]: [string, any]) => [
              k,
              { ...v, dataURL: undefined },
            ]),
          );
          return text({
            type: "excalidraw",
            version: 2,
            source: "excalidash",
            elements: (d.elements ?? []).filter((e: any) => !e.isDeleted),
            appState: d.appState ?? {},
            files,
          });
        }
        const summary = summarizeElements(d.elements ?? []);
        return text({
          id: d.id,
          name: d.name,
          collectionId: d.collectionId,
          version: d.version,
          path: `/editor/${d.id}`,
          elementCount: summary.length,
          elements: summary,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "create_drawing",
    {
      description:
        "Create a new drawing, optionally with initial elements (same format as add_elements). Returns its id.",
      inputSchema: {
        name: z.string().min(1).max(255),
        collectionId: z.string().optional(),
        elements: z.array(skeletonSchema).max(500).optional(),
      },
    },
    async ({ name, collectionId, elements }) => {
      try {
        const built = buildElements((elements ?? []) as Skeleton[]);
        const res = await api("POST", "/drawings", {
          name,
          collectionId: collectionId ?? null,
          elements: built.created,
          appState: {},
        });
        if (res.status !== 200) return fail(errorMessage(res));
        return text({
          id: res.body.id,
          name: res.body.name,
          path: `/editor/${res.body.id}`,
          created: built.created.length,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "import_excalidraw",
    {
      description:
        "Create a drawing from a complete standard .excalidraw JSON document (elements, appState, files) - e.g. one you generated or copied from excalidraw.com.",
      inputSchema: {
        name: z.string().min(1).max(255),
        scene: z
          .object({
            elements: z.array(z.record(z.string(), z.any())),
            appState: z.record(z.string(), z.any()).optional(),
            files: z.record(z.string(), z.any()).optional(),
          })
          .passthrough(),
        collectionId: z.string().optional(),
      },
    },
    async ({ name, scene, collectionId }) => {
      const res = await api("POST", "/drawings", {
        name,
        collectionId: collectionId ?? null,
        elements: scene.elements,
        appState: scene.appState ?? {},
        files: scene.files,
      });
      if (res.status !== 200) return fail(errorMessage(res));
      return text({ id: res.body.id, path: `/editor/${res.body.id}` });
    },
  );

  server.registerTool(
    "add_elements",
    {
      description:
        "Add shapes, text, arrows and lines to an existing drawing. Shapes take an optional `label` (centred text, auto-sizing). Arrows with `from`/`to` shape ids snap to the shape edges and stay attached. Existing elements are untouched; open editors update live.",
      inputSchema: {
        id: z.string().describe("Drawing id"),
        elements: z.array(skeletonSchema).min(1).max(500),
      },
    },
    async ({ id, elements }) => {
      try {
        const { result, version } = await mutateScene(id, (scene) => {
          const built = buildElements(elements as Skeleton[], scene);
          // Existing shapes gain boundElements entries for new arrows.
          scene.push(...built.created);
          return built.created.map((e) => ({ id: e.id, type: e.type }));
        });
        return text({ added: result, version });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "update_elements",
    {
      description:
        "Change properties of existing elements by id: position (x, y), size, colours, stroke, opacity, font size, or text (for a shape/arrow this edits its label). Use get_drawing first to find ids.",
      inputSchema: {
        id: z.string().describe("Drawing id"),
        updates: z
          .array(
            z.object({
              id: z.string(),
              set: z.record(z.string(), z.any()),
            }),
          )
          .min(1)
          .max(500),
      },
    },
    async ({ id, updates }) => {
      try {
        const { result, version } = await mutateScene(id, (scene) => {
          const changed: string[] = [];
          for (const u of updates) {
            const el = scene.find((e) => e.id === u.id && !e.isDeleted);
            if (!el) throw new Error(`No element with id ${u.id}`);
            for (const t of patchElement(el, u.set, scene)) changed.push(t.id);
          }
          return [...new Set(changed)];
        });
        return text({ updated: result, version });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "delete_elements",
    {
      description:
        "Remove elements by id (their labels and any arrows attached to them go too). Reversible from the editor's history.",
      inputSchema: {
        id: z.string().describe("Drawing id"),
        elementIds: z.array(z.string()).min(1).max(500),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, elementIds }) => {
      try {
        const { result, version } = await mutateScene(id, (scene) => {
          const unknown = elementIds.filter(
            (eid) => !scene.some((e) => e.id === eid && !e.isDeleted),
          );
          if (unknown.length)
            throw new Error(`No element with id: ${unknown.join(", ")}`);
          return deleteElements(elementIds, scene);
        });
        return text({ deleted: result, version });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "update_drawing",
    {
      description:
        'Rename a drawing and/or move it to a collection (collectionId null = unfiled, "trash" = move to trash, which is recoverable). Drawings cannot be permanently deleted through MCP.',
      inputSchema: {
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        collectionId: z.string().nullable().optional(),
      },
    },
    async ({ id, name, collectionId }) => {
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (collectionId !== undefined) body.collectionId = collectionId;
      if (Object.keys(body).length === 0)
        return fail("Provide name and/or collectionId");
      const res = await api("PUT", `/drawings/${encodeURIComponent(id)}`, body);
      if (res.status !== 200) return fail(errorMessage(res));
      return text({
        id: res.body.id,
        name: res.body.name,
        collectionId: res.body.collectionId,
      });
    },
  );

  return server;
};
