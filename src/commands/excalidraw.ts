import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RoomClient } from "../client/room-client.ts";
import type { RoomConfig } from "../config.ts";
import { formatRoomLink } from "../link.ts";

/**
 * One command. If a package that also wants `/excalidraw` is installed
 * alongside, Pi keeps both and suffixes the later one — rename this constant
 * then, instead of relying on the suffix.
 */
const COMMAND = "excalidraw";

const HELP = [
  `/${COMMAND} join <room-url>   join a live collaboration room`,
  `/${COMMAND} leave             disconnect`,
  `/${COMMAND} status            connection, peers and scene size`,
  `/${COMMAND} open              open the room in the browser`,
].join("\n");

/** Open a URL without blocking the session or leaking the key into logs. */
function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export function registerExcalidrawCommand(
  pi: ExtensionAPI,
  client: RoomClient,
  config: RoomConfig,
): void {
  pi.registerCommand(COMMAND, {
    description: "Manage the live Excalidraw collaboration room",
    handler: async (args, ctx) => {
      const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const rest1 = rest.join(" ").trim();

      switch (sub ?? "status") {
        case "join": {
          const link = rest1 || config.roomLink;
          if (!link) {
            ctx.ui.notify(`/${COMMAND} join <room-url>\n${HELP}`, "error");
            return;
          }
          try {
            const status = await client.join(link);
            ctx.ui.notify(
              `joined ${status.room} — ${status.elementCount} element(s), ${status.peers.length} peer(s)`,
              "info",
            );
          } catch (err) {
            ctx.ui.notify(`join failed: ${(err as Error).message}`, "error");
          }
          return;
        }
        case "leave": {
          const room = client.roomIdOrNull;
          await client.leave();
          ctx.ui.notify(room ? `left ${room}` : "was not connected", "info");
          return;
        }
        case "status": {
          const status = client.status();
          ctx.ui.notify(
            status.connected
              ? `connected to ${status.room} · ${status.elementCount} element(s) · ${status.peers.length} peer(s)`
              : "not connected",
            "info",
          );
          return;
        }
        case "open": {
          const link = client.roomLink;
          if (!link) {
            ctx.ui.notify(`join a room first, then /${COMMAND} open reopens it`, "error");
            return;
          }
          const baseUrl = link.baseUrl ?? config.frontendUrl;
          try {
            openInBrowser(formatRoomLink(baseUrl, link));
            ctx.ui.notify(`opened ${baseUrl} in your browser`, "info");
          } catch (err) {
            ctx.ui.notify(`could not open a browser: ${(err as Error).message}`, "error");
          }
          return;
        }
        default:
          ctx.ui.notify(HELP, "info");
      }
    },
  });
}
