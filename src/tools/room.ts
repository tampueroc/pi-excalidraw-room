import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RoomClient } from "../client/room-client.ts";
import type { RoomConfig } from "../config.ts";

function statusText(client: RoomClient): string {
  const status = client.status();
  if (!status.connected) {
    return "not connected — join with /excalidraw join <room-url> or the excalidraw_join tool";
  }
  const peers = status.peers.length
    ? status.peers.map((peer) => peer.name ?? `anonymous ${peer.socketId.slice(0, 6)}`).join(", ")
    : "none";
  return [
    `connected to ${status.room} via ${status.relayUrl}`,
    `agent name: ${status.name}`,
    `peers: ${peers}`,
    `scene: ${status.elementCount} element(s)${status.deletedCount ? `, ${status.deletedCount} deleted` : ""}, version ${status.sceneVersion}`,
    `scene source: ${status.source ?? "unknown"}`,
    `last remote update: ${status.lastRemoteUpdate ?? "never"}`,
  ].join("\n");
}

export function registerRoomTools(pi: ExtensionAPI, client: RoomClient, config: RoomConfig): void {
  pi.registerTool({
    name: "excalidraw_join",
    label: "Join Excalidraw Room",
    description:
      "Join an Excalidraw live collaboration room so later excalidraw_* tools read and edit the diagram a person has open in the browser.",
    promptSnippet: "Join a live Excalidraw collaboration room (room URL with #room=<id>,<key>)",
    promptGuidelines: [
      "Use excalidraw_join before any other excalidraw tool when the user gives you a collaboration room URL.",
    ],
    parameters: Type.Object({
      link: Type.Optional(
        Type.String({
          description:
            "Collaboration room URL or `<roomId>,<roomKey>` pair. Defaults to EXCALIDRAW_ROOM_LINK.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const details: Record<string, unknown> = { ok: false };
      const link = (params.link ?? config.roomLink)?.trim();
      if (!link) {
        return {
          content: [
            {
              type: "text",
              text: "No room link. Pass `link` or set EXCALIDRAW_ROOM_LINK to a #room=<id>,<key> URL.",
            },
          ],
          details,
        };
      }
      try {
        const status = await client.join(link);
        details.ok = true;
        details.roomId = status.roomId;
        details.peers = status.peers;
        details.elementCount = status.elementCount;
        return {
          content: [{ type: "text", text: `joined ${status.room}\n${statusText(client)}` }],
          details,
        };
      } catch (err) {
        details.error = (err as Error).message;
        return {
          content: [{ type: "text", text: `join failed: ${(err as Error).message}` }],
          details,
        };
      }
    },
  });

  pi.registerTool({
    name: "excalidraw_leave",
    label: "Leave Excalidraw Room",
    description: "Disconnect from the current Excalidraw collaboration room.",
    parameters: Type.Object({}),
    async execute() {
      const room = client.roomIdOrNull;
      await client.leave();
      return {
        content: [{ type: "text", text: room ? `left room ${room}` : "was not connected" }],
        details: { ok: true, roomId: room } as Record<string, unknown>,
      };
    },
  });

  pi.registerTool({
    name: "excalidraw_status",
    label: "Excalidraw Room Status",
    description:
      "Report whether the agent is in a collaboration room, who else is there, and how many elements the local scene holds.",
    promptSnippet: "Check the Excalidraw room connection, peers and scene size",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: statusText(client) }],
        details: client.status() as unknown as Record<string, unknown>,
      };
    },
  });
}
