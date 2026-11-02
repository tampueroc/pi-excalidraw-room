/**
 * Dev tool: join a room, wait, print the scene the way excalidraw_read sees it.
 *   node scripts/inspect.ts "<room-url>" [seconds]
 */
import { loadConfig } from "../src/config.ts";
import { RoomClient } from "../src/client/room-client.ts";
import { summarizeScene } from "../src/scene/describe.ts";

const [link, secondsArg] = process.argv.slice(2);
if (!link) {
  console.error('usage: node scripts/inspect.ts "<room-url>" [seconds]');
  process.exit(2);
}
const seconds = Number(secondsArg ?? 3);

const client = new RoomClient(loadConfig());
const status = await client.join(link);
console.log(
  `joined ${status.room} · ${status.elementCount} element(s) · ${status.peers.length} peer(s) · source ${status.source}`,
);

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const after = client.status();
console.log(`after ${seconds}s: ${after.elementCount} element(s), ${after.peers.length} peer(s)`);
console.log(`peers: ${after.peers.map((p) => `${p.name ?? "anonymous"}:${p.socketId.slice(0, 6)}`).join(", ") || "none"}`);
console.log(summarizeScene(client.elements(true)).text);
client.leave();
