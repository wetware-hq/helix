// The verifier agent: POST /verify. It holds the verifier key, reads the store and the
// pinned authorities, and signs one VerifyResponse. It never writes.
import { importSecret, signObject } from "./lib/crypto";
import { checkEdit } from "./lib/verify";
import { store, type Store } from "./store";
import {
  helixSignatureOk, offerDigest, rnaDigest, type Offer, type PaymentPayload, type VerifyResponse,
} from "./lib/x402";
import type { Json } from "./lib/jcs";

export { Store } from "./store";

type Env = {
  STORE: DurableObjectNamespace<Store>;
  HELIX_SK: string;
  HELIX_KEY: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/verify") {
      return json({ code: "bad_envelope", id: null }, 404);
    }
    const raw = await request.text();
    if (raw.length > 256 * 1024) return json({ code: "too_large", id: null }, 413);

    let body: {
      paymentPayload: PaymentPayload;
      paymentRequirements: Json;
      offer: Offer;
      route: string;
    };
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ code: "bad_envelope", id: null }, 400);
    }

    const db = store(env as never);
    const roles = await db.roles();
    const signer = await helixSignatureOk(
      request.headers.get("Helix-Signature"),
      body as unknown as Json,
      roles.endpoint,
    );
    if (!signer) return json({ code: "no_role", id: null }, 403);

    const rna = body.paymentPayload?.payload?.rna;
    if (!rna || typeof rna !== "object") return json({ code: "bad_envelope", id: null }, 400);

    const code = await checkEdit({
      payload: body.paymentPayload,
      paymentRequirements: body.paymentRequirements,
      offer: body.offer,
      route: body.route,
      verifierKey: env.HELIX_KEY,
      roles,
      chain: await db.chain(),
      locus: await db.locus(body.route),
    });

    const base = {
      payer: rna.editor,
      rna: await rnaDigest(rna),
      offer: await offerDigest(body.offer),
      verifier: env.HELIX_KEY,
    };
    const response: Omit<VerifyResponse, "sig"> = code
      ? { isValid: false, invalidReason: code, ...base }
      : { isValid: true, ...base };
    const sk = await importSecret(env.HELIX_SK);
    return json({ ...response, sig: await signObject(sk, response as unknown as Json) });
  },
};

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
