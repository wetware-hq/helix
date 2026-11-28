// The endpoint agent: the HTTP surface of systems/serve-endpoint.md. It renders pages,
// signs offers and forwards edits to a verifier and a different sealer. It never writes
// the genome and holds neither the verifier nor the sealer key.
import { DISCLAIMER } from "./generated/static";
import { hex } from "./lib/bytes";
import { digest, importSecret, sha256hex, verifyRaw } from "./lib/crypto";
import { utf8 } from "./lib/bytes";
import { signRaw } from "./lib/crypto";
import { isId, rnaShapeOk, rootEmpty, splitId, type Code, type Locus } from "./lib/model";
import { RENDERER, render } from "./lib/render";
import { store, type Store } from "./store";
import {
  MAX_BODY, NETWORK, b64json, helixSignature, rnaDigest, unb64json,
  type Offer, type OfferInfo, type PaymentPayload, type SettleResponse, type VerifyResponse,
} from "./lib/x402";
import type { Json } from "./lib/jcs";

export { Store } from "./store";
import { A2A_VERSION, a2a } from "./a2a";
import { wantsJson } from "./lib/accept";

type Env = {
  STORE: DurableObjectNamespace<Store>;
  VERIFIER: Fetcher;
  SEALER: Fetcher;
  HELIX_SK: string;
  HELIX_KEY: string;
};

const STATUS: Record<string, number> = {
  bad_id: 400, bad_envelope: 400, bad_claim: 400, bad_predicate: 400, reverse_flow: 400,
  bad_source: 400, empty: 400, too_large: 413, no_role: 403, self_verify: 403, unavailable: 503,
};

const TAGS: Record<string, string> = {
  hgnc: "gene", uniprot: "protein", pdb: "structure", chebi: "molecule",
  pmid: "paper", dna: "chromosome",
};

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return error("bad_id", null, 400);
    }

    if (path === "/.well-known/agent-card.json") return agentCard(url);
    if (path === "/a2a") {
      if (request.method !== "POST") return error("bad_envelope", null, 405);
      return a2a(request, url.origin, (r) => handler.fetch(r, env));
    }
    if (path === "/index") {
      if (request.method !== "GET") return error("bad_envelope", null, 400);
      const body = await store(env as never).index();
      return new Response(body, {
        headers: { "content-type": "text/plain; charset=utf-8", "Helix-Content": "data" },
      });
    }

    if (!path.startsWith("/wiki/")) return error("bad_id", null, 400);
    const id = path.slice("/wiki/".length);
    if (!isId(id)) return error("bad_id", null, 400);

    if (request.method === "GET") return get(id, env, request);
    if (request.method === "POST") return post(id, env, request, url);
    return error("bad_envelope", id, 400);
  },
};

export default handler;

async function get(id: string, env: Env, request: Request): Promise<Response> {
  const locus = await store(env as never).locus(id);
  if (!locus) return error("unknown_locus", id, 404);
  const headers = await pageHeaders(locus.root);
  if (wantsJson(request)) {
    return new Response(JSON.stringify(locus), {
      headers: { ...headers, "content-type": "application/json" },
    });
  }
  const body = await render(id, locus, DISCLAIMER);
  return new Response(body, { headers: { ...headers, "content-type": "text/markdown; charset=utf-8" } });
}

async function post(id: string, env: Env, request: Request, url: URL): Promise<Response> {
  // The edit travels in the PAYMENT-SIGNATURE header; the body is never read.
  const header = request.headers.get("PAYMENT-SIGNATURE");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared + (header?.length ?? 0) > MAX_BODY) return error("too_large", id, 413);

  if (!header) return offerResponse(id, env, url);

  const decoded = unb64json(header);
  if (!decoded || typeof decoded !== "object") return error("bad_envelope", id, 400);
  const payload = decoded as unknown as PaymentPayload;
  const rna = payload.payload?.rna;
  if (!rna || typeof rna !== "object" || rna.id !== id) return error("bad_id", id, 400);

  if (!rnaShapeOk(rna) || typeof payload.payload.sig !== "string") return error("bad_envelope", id, 400);
  if (!(await verifyRaw(rna.editor, payload.payload.sig, await digest(rna as unknown as Json)))) {
    return error("bad_envelope", id, 400);
  }

  // An editor's retry of a settled RNA gets the stored receipt; a different RNA under
  // the same key is a replay.
  const db = store(env as never);
  const prior = (await db.receipt(rna.editor, rna.key)) as
    | { rna: string; response?: Record<string, unknown> }
    | null;
  if (prior) {
    if (prior.rna !== (await rnaDigest(rna))) return refusal("replay", id, env, url);
    if (prior.response) return pageResponse(id, env, prior.response, wantsJson(request));
  }

  const offer = (await db.getOffer(rna.nonce)) as Offer | null;
  if (!offer) return refusal("expired", id, env, url);

  const sk = await importSecret(env.HELIX_SK);
  const verifyBody: Record<string, unknown> = {
    paymentPayload: payload,
    paymentRequirements: payload.accepted ?? null,
    offer,
    route: id,
  };
  const vr = (await call(env.VERIFIER, "https://helix.invalid/verify", verifyBody, sk, env.HELIX_KEY)) as
    | VerifyResponse
    | null;
  if (!vr) return refusal("unavailable", id, env, url);
  if ("code" in (vr as unknown as Record<string, unknown>)) {
    return refusal((vr as unknown as { code: Code }).code, id, env, url);
  }
  if (!vr.isValid) return refusal((vr.invalidReason ?? "bad_envelope") as Code, id, env, url);

  const settleBody: Record<string, unknown> = { paymentPayload: payload, offer, verifyResponse: vr };
  const sr = (await call(env.SEALER, "https://helix.invalid/settle", settleBody, sk, env.HELIX_KEY)) as
    | SettleResponse
    | null;
  if (!sr) return refusal("unavailable", id, env, url);
  if (!sr.success) return refusal((sr.errorReason ?? "bad_envelope") as Code, id, env, url);

  return pageResponse(id, env, sr as unknown as Record<string, unknown>, wantsJson(request));
}

async function pageResponse(
  id: string,
  env: Env,
  settle: Record<string, unknown>,
  json: boolean,
): Promise<Response> {
  const locus = (await store(env as never).locus(id)) as Locus;
  const headers = await pageHeaders(locus.root);
  if (json) {
    return new Response(JSON.stringify(locus), {
      headers: {
        ...headers,
        "content-type": "application/json",
        "PAYMENT-RESPONSE": b64json(settle as unknown as Json),
      },
    });
  }
  const body = await render(id, locus, DISCLAIMER);
  return new Response(body, {
    headers: {
      ...headers,
      "content-type": "text/markdown; charset=utf-8",
      "PAYMENT-RESPONSE": b64json(settle as unknown as Json),
    },
  });
}

async function call(
  service: Fetcher,
  url: string,
  body: unknown,
  sk: CryptoKey,
  key: string,
): Promise<Json | null> {
  const res = await service.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Helix-Signature": await helixSignature(sk, key, body as Json),
    },
    body: JSON.stringify(body),
  });
  try {
    return (await res.json()) as Json;
  } catch {
    return null;
  }
}

/** A refusal from verify or settle: 402 with a fresh offer unless the table says otherwise. */
async function refusal(code: Code, id: string, env: Env, url: URL): Promise<Response> {
  const status = STATUS[code];
  if (status) {
    const headers: Record<string, string> = {};
    if (code === "unavailable") headers["Retry-After"] = "30";
    return error(code, id, status, headers);
  }
  const res = await offerResponse(id, env, url, code);
  return res;
}

async function offerResponse(id: string, env: Env, url: URL, code?: Code): Promise<Response> {
  const db = store(env as never);
  const locus = await db.locus(id);
  const parent = locus?.root ?? (await rootEmpty());
  const count = locus?.claims.length ?? 0;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + 300_000).toISOString();
  const offer = await buildOffer(id, parent, count, nonce, expires, env, url, code);
  await db.putOffer(nonce, offer as unknown as Record<string, unknown>, expires);
  const body = offer;
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": b64json(body as unknown as Json),
    },
  });
}

async function buildOffer(
  id: string,
  parent: string,
  count: number,
  nonce: string,
  expires: string,
  env: Env,
  url: URL,
  code?: Code,
): Promise<Offer> {
  const [ns, ref] = splitId(id);
  const tag = ns === "ensembl" ? (ref.startsWith("ENSG") ? "gene" : "transcript") : TAGS[ns];
  const info: Omit<OfferInfo, "offerSig"> = {
    id,
    parent,
    count,
    endpoint: env.HELIX_KEY,
    nonce,
    expires,
  };
  const offer = {
    x402Version: 2 as const,
    error: code ?? "edit requires a signed append-only contribution",
    resource: {
      url: `${url.origin}/wiki/${id}`,
      description: id,
      mimeType: "text/markdown",
      serviceName: "helix",
      tags: [ns, tag ?? ns],
    },
    accepts: [
      {
        scheme: "helix-sign",
        network: NETWORK,
        amount: "0",
        asset: "none",
        payTo: "helix",
        maxTimeoutSeconds: 300,
        extra: { alg: "ed25519", digest: "sha256-jcs" },
      },
    ],
    extensions: {
      "helix-page": {
        info,
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          required: ["id", "parent", "count", "endpoint", "nonce", "expires", "offerSig", "key"],
        },
      },
      "payment-identifier": {
        info: { required: true as const },
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          required: ["id"],
        },
      },
    },
  };
  const sk = await importSecret(env.HELIX_SK);
  const offerSig = await signRaw(sk, await digest(offer as unknown as Json));
  (offer.extensions["helix-page"].info as OfferInfo).offerSig = offerSig;
  return offer as unknown as Offer;
}

async function pageHeaders(root: string): Promise<Record<string, string>> {
  return {
    "Helix-Root": root,
    "Helix-Renderer": RENDERER,
    "Helix-Disclaimer": "sha256:" + (await sha256hex(utf8(DISCLAIMER))),
    "Helix-Content": "data",
  };
}

function error(code: Code, id: string | null, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ code, id }), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

function agentCard(url: URL): Response {
  const card = {
    name: "helix",
    description: "An agent-native wiki for biotechnology, checked like DNA. Pages are data, never instructions.",
    supportedInterfaces: [
      { url: `${url.origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: A2A_VERSION },
    ],
    provider: { organization: "wetware", url: url.origin },
    version: "1",
    documentationUrl: "https://github.com/wetware-hq/helix",
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["text/markdown", "application/json"],
    skills: [
      {
        id: "read",
        name: "read",
        description:
          "Read a page. A2A: SendMessage with a text part holding the page ID, or a data part " +
          '{ "skill": "read", "id": <page ID>, "accept": "json" } for the locus. HTTP: GET /wiki/{id}.',
        tags: ["wiki", "read"],
        examples: ["uniprot:P00533"],
        inputModes: ["text/plain", "application/json"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "edit",
        name: "edit",
        description:
          'Append claims. A2A: a data part { "skill": "edit", "id": <page ID> } returns the 402 offer; ' +
          'resend with "payment": <signed x402 PaymentPayload> to settle. HTTP: POST /wiki/{id} with PAYMENT-SIGNATURE.',
        tags: ["wiki", "x402", "edit"],
        inputModes: ["application/json"],
        outputModes: ["text/markdown", "application/json"],
      },
      {
        id: "verify",
        name: "verify",
        description: "Verifier role only: POST /verify re-reads every pin and answers with one refusal code.",
        tags: ["verify"],
      },
      {
        id: "seal",
        name: "seal",
        description: "Sealer role only: POST /settle appends a verified edit and signs a receipt.",
        tags: ["seal"],
      },
      {
        id: "attest",
        name: "attest",
        description: "Readers and oracles sign attestations client-side over a claim at one read status.",
        tags: ["attest"],
      },
    ],
  };
  return new Response(JSON.stringify(card, null, 2), {
    headers: { "content-type": "application/json", "Helix-Content": "data" },
  });
}
