/**
 * Parsing of Excalidraw collaboration links.
 *
 * A room link carries both identifiers the relay needs:
 *   http://127.0.0.1/#room=<roomId>,<roomKey>
 * roomId is 20 lowercase hex chars, roomKey is a 22 char base64url encoded
 * 128-bit AES key. Both come from upstream's generateRoomId/generateRoomKey.
 */

export interface RoomLink {
  roomId: string;
  roomKey: string;
  /** Everything before the `#room=` fragment, useful for `/excalidraw open`. */
  baseUrl: string | null;
}

const FRAGMENT = /#room=([^,&\s]+),([^&\s]+)\s*$/;
const BARE = /^([A-Za-z0-9_-]+),([A-Za-z0-9_-]+)$/;
const ROOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const ROOM_KEY = /^[A-Za-z0-9_-]{22}$/;

export function parseRoomLink(input: string): RoomLink {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("empty collaboration link");

  const fragment = trimmed.match(FRAGMENT);
  const bare = trimmed.match(BARE);
  const match = fragment ?? bare;
  if (!match) {
    throw new Error("not a collaboration link: expected ...#room=<roomId>,<roomKey>");
  }

  const [, roomId, roomKey] = match;
  if (!roomId || !ROOM_ID.test(roomId)) {
    throw new Error(`invalid room id ${JSON.stringify(roomId)}`);
  }
  if (!roomKey || !ROOM_KEY.test(roomKey)) {
    throw new Error("invalid room key: expected 22 base64url characters");
  }

  const baseUrl = fragment ? trimmed.slice(0, trimmed.indexOf("#")) || null : null;
  return { roomId, roomKey, baseUrl };
}

/** Build a shareable link, given the frontend the room lives on. */
export function formatRoomLink(baseUrl: string, link: RoomLink): string {
  return `${baseUrl.replace(/\/+$/, "")}/#room=${link.roomId},${link.roomKey}`;
}

/** Never print the key: links are secrets. */
export function redactLink(link: RoomLink): string {
  return `#room=${link.roomId},${"*".repeat(link.roomKey.length)}`;
}
