/**
 * AES-GCM helpers, matching packages/excalidraw/data/encryption.ts upstream.
 * The room key from a collaboration link is the raw 128-bit key, base64url
 * encoded, used as the `k` of an oct JWK.
 */
import type { webcrypto } from "node:crypto";

const KEY_BITS = 128;
export const IV_LENGTH_BYTES = 12;

type Usage = "encrypt" | "decrypt";

async function importKey(key: string, usage: Usage): Promise<webcrypto.CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { alg: "A128GCM", ext: true, k: key, key_ops: ["encrypt", "decrypt"], kty: "oct" },
    { name: "AES-GCM", length: KEY_BITS },
    false,
    [usage],
  );
}

export interface Encrypted {
  ciphertext: ArrayBuffer;
  /** The 12 byte initialisation vector; the relay carries it beside the ciphertext. */
  iv: Uint8Array;
}

export async function encryptJson(key: string, value: unknown): Promise<Encrypted> {
  return encrypt(key, new TextEncoder().encode(JSON.stringify(value)));
}

export async function encrypt(key: string, plaintext: Uint8Array): Promise<Encrypted> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  // WebCrypto wants an ArrayBuffer-backed view; a Uint8Array can be backed by a
  // SharedArrayBuffer by type, which it refuses.
  const data = new Uint8Array(plaintext) as unknown as Uint8Array<ArrayBuffer>;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importKey(key, "encrypt"),
    data,
  );
  return { ciphertext, iv };
}

export async function decrypt<T>(
  key: string,
  iv: Uint8Array,
  ciphertext: ArrayBuffer | Uint8Array,
): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as Uint8Array<ArrayBuffer> },
    await importKey(key, "decrypt"),
    ciphertext as unknown as Uint8Array<ArrayBuffer>,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
