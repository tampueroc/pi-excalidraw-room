/**
 * Room persistence through the deployment's HTTP storage backend.
 *
 * The relay keeps nothing: a fresh join always gets `first-in-room`. What makes
 * a scene survive a reload is the body the frontend PUTs, decoded here from the
 * deployed 0.18.1 bundle:
 *
 *   uint32BE(sceneVersion) || iv(12 bytes) || AES-GCM(roomKey, JSON(elements))
 *
 * Route: `<base>/rooms/<roomId>` (GET 404 when the room was never saved).
 */
import { decrypt, encryptJson } from "../client/crypto.ts";

export interface StoredRoom {
  elements: unknown[];
  sceneVersion: number;
  /** Version the doc was written at, from the leading uint32. */
  version: number;
}

export type FetchLike = typeof fetch;

/** `uint32BE || iv || ciphertext`, the exact layout the frontend writes. */
export function encodeRoomBody(sceneVersion: number, iv: Uint8Array, ciphertext: ArrayBuffer): Uint8Array {
  const body = new Uint8Array(4 + iv.length + ciphertext.byteLength);
  new DataView(body.buffer).setUint32(0, sceneVersion, false);
  body.set(iv, 4);
  body.set(new Uint8Array(ciphertext), 4 + iv.length);
  return body;
}

export function decodeRoomBody(body: ArrayBuffer | Uint8Array): {
  version: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
} {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  if (bytes.byteLength < 4 + 12) throw new Error("stored room body is too short");
  const version = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
  return { version, iv: bytes.slice(4, 16), ciphertext: bytes.slice(16) };
}

function roomUrl(baseUrl: string, roomId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/rooms/${encodeURIComponent(roomId)}`;
}

export async function loadRoom(
  baseUrl: string,
  roomId: string,
  roomKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<StoredRoom | null> {
  const response = await fetchImpl(roomUrl(baseUrl, roomId));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`storage GET ${response.status}`);

  const { version, iv, ciphertext } = decodeRoomBody(await response.arrayBuffer());
  const elements = await decrypt<unknown[]>(roomKey, iv, ciphertext);
  if (!Array.isArray(elements)) throw new Error("stored room is not an element list");
  return { elements, sceneVersion: version, version };
}

/** Returns true when the backend accepted the write. */
export async function saveRoom(
  baseUrl: string,
  roomId: string,
  roomKey: string,
  elements: unknown[],
  sceneVersion: number,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const { ciphertext, iv } = await encryptJson(roomKey, elements);
  const response = await fetchImpl(roomUrl(baseUrl, roomId), {
    method: "PUT",
    // The backend crashes on a body it cannot parse, so this is always a valid
    // uint32-prefixed, encrypted buffer — never an empty or partial write.
    // BodyInit wants an ArrayBuffer-backed body; copy so the type is exact.
    body: encodeRoomBody(sceneVersion, iv, ciphertext).slice().buffer,
  });
  if (!response.ok) throw new Error(`storage PUT ${response.status}`);
  return true;
}
