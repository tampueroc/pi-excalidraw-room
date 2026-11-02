/**
 * pi-excalidraw-room — the agent as a participant in a live Excalidraw room.
 *
 * Config: EXCALIDRAW_URL, EXCALIDRAW_RELAY_URL, EXCALIDRAW_ORIGIN,
 * EXCALIDRAW_AGENT_NAME, EXCALIDRAW_ROOM_LINK, EXCALIDRAW_TRANSPORT,
 * EXCALIDRAW_ROOM_DEBUG. See README/docs/IMPLEMENTATION_PLAN.md.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { RoomClient } from "./client/room-client.ts";
import { registerRoomTools } from "./tools/room.ts";
import { registerSceneTools } from "./tools/scene.ts";
import { registerFileTools } from "./tools/files.ts";
import { registerGraphTools } from "./tools/graph.ts";
import { registerExcalidrawCommand } from "./commands/excalidraw.ts";

export default function (pi: ExtensionAPI): void {
  const config = loadConfig();
  const client = new RoomClient(config);

  registerRoomTools(pi, client, config);
  registerSceneTools(pi, client);
  registerFileTools(pi, client);
  registerGraphTools(pi, client);
  registerExcalidrawCommand(pi, client, config);

  if (config.roomLink) {
    pi.on("session_start", async (_event, ctx) => {
      if (client.isConnected) return;
      try {
        const status = await client.join(config.roomLink!);
        ctx.ui.notify(
          `excalidraw: joined ${status.room} (${status.elementCount} element(s))`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(`excalidraw: ${(err as Error).message}`, "error");
      }
    });
  }

  pi.on("session_shutdown", async () => {
    // Flushes anything the storage backend has not seen yet.
    await client.leave();
  });
}
