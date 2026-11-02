import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RoomClient } from "../client/room-client.ts";
import { appendToScene, buildFile, parseFile, remapIds } from "../scene/file.ts";
import { markDeleted } from "../scene/mutations.ts";
import type { BuiltElement } from "../scene/elements.ts";

const NOT_IN_ROOM = "Not in a room. Call excalidraw_join with the collaboration link first.";

function requireRoom(client: RoomClient): string | null {
  return client.status().connected ? null : NOT_IN_ROOM;
}

export function registerFileTools(pi: ExtensionAPI, client: RoomClient): void {
  pi.registerTool({
    name: "excalidraw_export",
    label: "Export Excalidraw File",
    description:
      "Write the room's scene to an editable `.excalidraw` file, so the diagram can be committed, shared or reopened later.",
    promptSnippet: "Save the live scene to a .excalidraw file",
    parameters: Type.Object({
      path: Type.String({ description: "File to write, e.g. docs/architecture.excalidraw" }),
      includeDeleted: Type.Optional(
        Type.Boolean({ description: "Keep deleted elements in the file (default false)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }
      const target = resolve(ctx?.cwd ?? process.cwd(), params.path);
      try {
        const file = buildFile(client.elements(true), { includeDeleted: params.includeDeleted });
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
        return {
          content: [
            {
              type: "text",
              text: `exported ${file.elements.length} element(s) to ${target}`,
            },
          ],
          details: { ok: true, path: target, elementCount: file.elements.length },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `export failed: ${(err as Error).message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });

  pi.registerTool({
    name: "excalidraw_import",
    label: "Import Excalidraw File",
    description:
      "Add the contents of a `.excalidraw` file to the live room. Ids are remapped so an import never overwrites what is already there.",
    promptSnippet: "Load a .excalidraw file into the live room",
    parameters: Type.Object({
      path: Type.String({ description: "File to read, e.g. docs/architecture.excalidraw" }),
      replace: Type.Optional(
        Type.Boolean({ description: "Delete the current scene first (default false: import alongside)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const blocked = requireRoom(client);
      if (blocked) {
        return { content: [{ type: "text", text: blocked }], details: { ok: false } as Record<string, unknown> };
      }
      const source = resolve(ctx?.cwd ?? process.cwd(), params.path);
      try {
        const parsed = parseFile(readFileSync(source, "utf8"));
        let removed = 0;
        if (params.replace) {
          const visible = client.elements().map((element) => element.id);
          if (visible.length) {
            const deleted = markDeleted(client.sceneMap() as never, visible);
            removed = deleted.filter((element) => !element.containerId).length;
            await client.apply(deleted);
          }
        }

        const remapped = remapIds(parsed.elements);
        const prepared = appendToScene(remapped, client.lastIndex()) as unknown as BuiltElement[];
        await client.apply(prepared);

        const droppedFiles = Object.keys(parsed.files).length;
        const note = droppedFiles
          ? `\n${droppedFiles} embedded file(s) were not imported: image binaries are not transferred.`
          : "";
        return {
          content: [
            {
              type: "text",
              text: `imported ${prepared.length} element(s) from ${source}${params.replace ? ` (replaced ${removed} element(s))` : ""}${note}`,
            },
          ],
          details: {
            ok: true,
            path: source,
            added: prepared.length,
            replaced: removed,
            droppedFiles,
          },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `import failed: ${(err as Error).message}` }],
          details: { ok: false } as Record<string, unknown>,
        };
      }
    },
  });
}
