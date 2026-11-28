// The sealer agent: POST /settle. It holds the sealer key and is the only writer.
// Every state check that can change after /verify is repeated inside the store's lock.
import { importSecret, signObject, verifyRaw } from "./lib/crypto";
import { digest } from "./lib/crypto";
import { foldRoot, rnaShapeOk, type Receipt } from "./lib/model";
import { store, type SettleOutcome, type Store } from "./store";
import {
  NETWORK, helixSignatureOk, offerDigest, rnaDigest,
  type Offer, type PaymentPayload, type SettleResponse, type VerifyResponse,
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
    if (request.method !== "POST" || url.pathname !== "/settle") {
      return json({ code: "bad_envelope", id: null }, 404);
    }
    const raw = await request.text();
    if (raw.length > 256 * 1024) return json({ code: "too_large", id: null }, 413);

    let body: { paymentPayload: PaymentPayload; offer: Offer; verifyResponse: VerifyResponse };
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
    const sig = body.paymentPayload?.payload?.sig;
    if (!rnaShapeOk(rna) || typeof sig !== "string") {
      return json(fail("bad_envelope", ""));
    }
    const editor = rna.editor;
    const d = await rnaDigest(rna);
    if (!(await verifyRaw(editor, sig, await digest(rna as unknown as Json)))) {
      return json(fail("bad_envelope", editor));
    }

    const vr = body.verifyResponse;
    const info = body.offer?.extensions?.["helix-page"]?.info;
    if (!vr || !info) return json(fail("bad_envelope", editor));

    const vrBody: Omit<VerifyResponse, "sig"> = { ...vr };
    delete (vrBody as Partial<VerifyResponse>).sig;
    const vrOk =
      vr.rna === d &&
      vr.offer === (await offerDigest(body.offer)) &&
      vr.payer === editor &&
      vr.isValid === true &&
      (await verifyRaw(vr.verifier, vr.sig, await digest(vrBody as unknown as Json)));
    if (!vrOk) return json(fail("bad_envelope", editor));

    if (!roles.verifier.includes(vr.verifier) || !roles.sealer.includes(env.HELIX_KEY)) {
      return json(fail("no_role", editor));
    }
    if (new Set([editor, vr.verifier, env.HELIX_KEY]).size !== 3) {
      return json(fail("self_verify", editor));
    }

    // The offer must still be the endpoint's, signed and unexpired.
    const offerBody = JSON.parse(JSON.stringify(body.offer)) as Offer;
    const offerSig = info.offerSig;
    delete (offerBody.extensions["helix-page"].info as Partial<typeof info>).offerSig;
    const offerOk =
      roles.endpoint.includes(info.endpoint) &&
      (await verifyRaw(info.endpoint, offerSig, await digest(offerBody as unknown as Json)));
    if (!offerOk || Date.parse(rna.expires) < Date.now()) return json(fail("expired", editor));

    // The root is computable from parent and append alone (contract §3), so the receipt is
    // signed before the store call and written in the same put as the append.
    let root = rna.parent;
    for (const c of rna.append) root = await foldRoot(root, c);
    const receipt: Receipt = {
      rna: d,
      id: rna.id,
      root,
      editor,
      verifier: vr.verifier,
      sealer: env.HELIX_KEY,
      at: new Date().toISOString(),
    };
    const response = await settled(receipt, env);
    const outcome = (await db.settle({
      id: rna.id,
      editor,
      verifier: vr.verifier,
      sealer: env.HELIX_KEY,
      parent: rna.parent,
      nonce: rna.nonce,
      expires: rna.expires,
      key: rna.key,
      rnaDigest: d,
      append: rna.append,
      receipt,
      response: response as unknown as Record<string, unknown>,
    })) as unknown as SettleOutcome;
    if (outcome.state === "fail") return json(fail(outcome.code, editor));
    if (outcome.state === "receipt") {
      return json((outcome.response as unknown as Json) ?? (await settled(outcome.receipt, env)));
    }
    return json(response as unknown as Json);
  },
};

async function settled(receipt: Receipt, env: Env): Promise<SettleResponse> {
  const sk = await importSecret(env.HELIX_SK);
  return {
    success: true,
    transaction: receipt.root,
    network: NETWORK,
    payer: receipt.editor,
    extensions: {
      "helix-receipt": {
        info: { receipt: receipt as unknown as Json, sig: await signObject(sk, receipt as unknown as Json) },
      },
    },
  };
}

function fail(code: string, payer: string): SettleResponse {
  return { success: false, errorReason: code, transaction: "", network: NETWORK, payer };
}

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
