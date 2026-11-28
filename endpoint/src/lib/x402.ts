// x402 v2 envelope shapes helix uses, and the Helix-Signature header between agents.
import type { Json } from "./jcs";
import { digest, digestHex, signRaw, verifyRaw } from "./crypto";
import type { Claim, Rna } from "./model";

export type OfferInfo = {
  id: string; parent: string; count: number; endpoint: string;
  nonce: string; expires: string; offerSig: string;
};

export type Offer = {
  x402Version: 2;
  error: string;
  resource: Json;
  accepts: Json[];
  extensions: {
    "helix-page": { info: OfferInfo; schema: Json };
    "payment-identifier": { info: { required: true }; schema: Json };
  };
};

export type PaymentPayload = {
  x402Version: 2;
  resource: Json;
  accepted: Json;
  payload: { rna: Rna; sig: string };
  extensions: Json;
};

export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  payer: string;
  rna: string;
  offer: string;
  verifier: string;
  sig: string;
};

export type SettleResponse = {
  success: boolean;
  errorReason?: string;
  transaction: string;
  network: "helix:1";
  payer: string;
  extensions?: Json;
};

export const NETWORK = "helix:1";

export function b64json(x: Json): string {
  const bytes = new TextEncoder().encode(JSON.stringify(x));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64json(s: string): Json | null {
  try {
    const raw = atob(s.trim());
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as Json;
  } catch {
    return null;
  }
}

/** The signature the endpoint puts on every /verify and /settle request. */
export async function helixSignature(sk: CryptoKey, key: string, body: Json): Promise<string> {
  const sig = await signRaw(sk, await digest(body));
  return `key=${key}, sig=${sig}`;
}

export async function helixSignatureOk(header: string | null, body: Json, keys: string[]): Promise<string | null> {
  if (!header) return null;
  const m = /^key=([-_A-Za-z0-9]+),\s*sig=([-_A-Za-z0-9]+)$/.exec(header.trim());
  if (!m) return null;
  const [, key, sig] = m;
  if (!keys.includes(key)) return null;
  return (await verifyRaw(key, sig, await digest(body))) ? key : null;
}

export async function rnaDigest(rna: Rna): Promise<string> {
  return digestHex(rna as unknown as Json);
}

export async function offerDigest(offer: Offer): Promise<string> {
  return digestHex(offer as unknown as Json);
}

export function appendOf(payload: PaymentPayload): Claim[] {
  return payload.payload.rna.append;
}

export const MAX_BODY = 256 * 1024;

/** Read a request body, stopping as soon as it passes `limit` bytes; null when it does. */
export async function readBody(request: Request, limit = MAX_BODY): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
