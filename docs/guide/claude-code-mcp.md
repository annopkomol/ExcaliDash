---
title: Use ExcaliDash from Claude Code (MCP)
description: Connect Claude Code and other MCP clients to ExcaliDash so Claude can list, create and edit drawings.
---

# Use ExcaliDash from Claude Code (MCP)

ExcaliDash serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/mcp` (Streamable HTTP). Claude Code can then list your drawings, create new ones, and add, move, recolor or delete elements. Open editors update live, and everything is stored as standard Excalidraw elements, so a drawing still copy-pastes into excalidraw.com.

## Connect Claude Code

1. Create an API key under **Profile → API keys**. The default scopes (`drawings` and `collections`, read and write) are what the tools need. Use read-only scopes for a read-only connection.
2. Add the server. Behind the bundled frontend proxy the URL is `<your-url>/api/mcp`; talking to the backend directly it is `<backend-url>/mcp`.

```bash
claude mcp add --transport http excalidash https://excalidash.example.com/api/mcp \
  --header "Authorization: Bearer exd_your_key"
```

With `AUTH_MODE=disabled` no key is needed, so leave out `--header`.

## Tools

| Tool                                  | What it does                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `list_drawings`, `list_collections`   | Browse and search                                                                            |
| `get_drawing`                         | Compact element summary (default) or the full standard `.excalidraw` JSON                    |
| `render_drawing`                      | PNG image of the drawing so Claude can check layout after edits (simplified, not hand-drawn) |
| `create_drawing`, `import_excalidraw` | New drawing from simple element descriptions, or from a full `.excalidraw`                   |
| `add_elements`                        | Shapes with centered labels, text, and arrows attached with `from` / `to` ids                |
| `update_elements`, `delete_elements`  | Edit by id; deleting a shape also removes its label and attached arrows                      |
| `update_drawing`                      | Rename, move to a collection, or move to trash (no permanent delete)                         |

Edits are version-checked against the saved drawing, so a concurrent change in the browser is merged instead of overwritten.

## Turn it off

Set `MCP_ENABLED=false` to stop serving `/mcp`.

claude.ai custom connectors need OAuth sign-in, which is not implemented yet; API-key clients such as Claude Code work today.
