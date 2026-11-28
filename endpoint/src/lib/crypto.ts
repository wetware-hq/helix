import { jcs, type Json } from "./jcs";
import { b64url, hex, unb64url, utf8 } from "./bytes";

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

export async function sha256hex(data: Uint8Array): Promise<string> {
  return hex(await sha256(data));
}

/** The 32 raw bytes of sha256(JCS(x)): what every helix signature covers. */
export async function digest(x: Json): Promise<Uint8Array> {
  return sha256(utf8(jcs(x)));
}

export async function digestHex(x: Json): Promise<string> {
  return hex(await digest(x));
}

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

/** A secret key is the unpadded base64url of the 32-byte Ed25519 seed. */
export async function importSecret(seedB64url: string): Promise<CryptoKey> {
  const seed = unb64url(seedB64url);
  if (seed.length !== 32) throw new Error("ed25519 seed must be 32 bytes");
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
  return crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "Ed25519" }, false, ["sign"]);
}

export async function signRaw(sk: CryptoKey, message: Uint8Array): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.sign("Ed25519", sk, message as BufferSource)));
}

/** Sign sha256(JCS(x)) with the agent's key; returns unpadded base64url. */
export async function signObject(sk: CryptoKey, x: Json): Promise<string> {
  return signRaw(sk, await digest(x));
}

export async function verifyRaw(key: string, sig: string, message: Uint8Array): Promise<boolean> {
  let pub: Uint8Array;
  let s: Uint8Array;
  try {
    pub = unb64url(key);
    s = unb64url(sig);
  } catch {
    return false;
  }
  if (pub.length !== 32 || s.length !== 64) return false;
  try {
    const k = await crypto.subtle.importKey("raw", pub as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return crypto.subtle.verify("Ed25519", k, s as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

export async function verifyObject(key: string, sig: string, x: Json): Promise<boolean> {
  return verifyRaw(key, sig, await digest(x));
}

export function isKey(s: unknown): s is string {
  if (typeof s !== "string" || !/^[-_A-Za-z0-9]{43}$/.test(s)) return false;
  try {
    return unb64url(s).length === 32;
  } catch {
    return false;
  }
}
