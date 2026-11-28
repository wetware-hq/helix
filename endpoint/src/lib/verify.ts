// skills/verify-claim.md: run the ordered checks over one signed edit and answer with
// the first failing code. Read-only: nothing here writes.
import { jcs, type Json } from "./jcs";
import { verifyRaw } from "./crypto";
import { digest } from "./crypto";
import {
  CHECKED, claimShapeError, cid, isId, namespaceOf, predicateError, readRank, rnaShapeOk,
  rootEmpty, splitId, type Chain, type Claim, type Code, type Locus, type Roles,
} from "./model";
import {
  PAPER_PREDICATES, badSource, binds, ceilingOf, fetchJson, gate, pinDigest, pointer, pinTarget,
  attestationError, type Fetched,
} from "./pins";
import type { Offer, PaymentPayload } from "./x402";

const MAX_CLAIMS = 32;
const MAX_FETCHES = 64;

export type CheckInput = {
  payload: PaymentPayload;
  paymentRequirements: Json;
  offer: Offer;
  route: string;
  verifierKey: string;
  roles: Roles;
  chain: Chain;
  locus: Locus | null;
};

function same(a: Json, b: Json): boolean {
  return jcs(a) === jcs(b);
}

class Fetcher {
  private cache = new Map<string, Fetched>();
  count = 0;

  async get(url: string): Promise<Fetched | "too_many"> {
    const hit = this.cache.get(url);
    if (hit) return hit;
    if (this.count >= MAX_FETCHES) return "too_many";
    this.count++;
    const got = await fetchJson(url);
    this.cache.set(url, got);
    return got;
  }
}

export async function checkEdit(input: CheckInput): Promise<Code | null> {
  const { payload, offer, route, verifierKey, roles, chain, locus } = input;
  const info = offer.extensions?.["helix-page"]?.info;
  if (!info) return "bad_envelope";

  // 1. envelope
  if (payload?.x402Version !== 2) return "bad_envelope";
  const inner = payload.payload as unknown as Record<string, unknown> | undefined;
  if (!inner || typeof inner !== "object") return "bad_envelope";
  const innerKeys = Object.keys(inner);
  if (innerKeys.length !== 2 || !innerKeys.includes("rna") || !innerKeys.includes("sig")) {
    return "bad_envelope";
  }
  const rna = inner.rna;
  if (!rnaShapeOk(rna) || typeof inner.sig !== "string") return "bad_envelope";
  if (!same(payload.resource ?? null, offer.resource)) return "bad_envelope";
  if (!offer.accepts?.some((a) => same(a, payload.accepted ?? null))) return "bad_envelope";
  if (!same(payload.accepted ?? null, input.paymentRequirements ?? null)) return "bad_envelope";
  if (!(await verifyRaw(rna.editor, inner.sig, await digest(rna as unknown as Json)))) {
    return "bad_envelope";
  }
  if (rna.append.length > MAX_CLAIMS) return "too_large";

  // 2. identity
  if (rna.id !== route || !isId(rna.id)) return "bad_id";
  for (const c of rna.append) {
    if (!c || typeof c !== "object" || (c as Claim).subject !== rna.id) return "bad_id";
  }

  // 3. offer
  const offerBody = JSON.parse(JSON.stringify(offer)) as Offer;
  const sig = info.offerSig;
  delete (offerBody.extensions["helix-page"].info as Partial<typeof info>).offerSig;
  if (!roles.endpoint.includes(info.endpoint)) return "no_role";
  if (!(await verifyRaw(info.endpoint, sig, await digest(offerBody as unknown as Json)))) {
    return "expired";
  }
  if (info.id !== rna.id) return "expired";
  if (Date.parse(rna.expires) < Date.now()) return "expired";

  // 4. echo
  const echoed = (payload.extensions as Record<string, { info?: Json }> | undefined)?.["helix-page"]?.info;
  const identifier = (payload.extensions as Record<string, { info?: Json }> | undefined)?.[
    "payment-identifier"
  ]?.info;
  if (!same(echoed ?? null, { ...info, key: rna.key } as unknown as Json)) return "overwrite";
  if (!same(identifier ?? null, { required: true, id: rna.key })) return "overwrite";
  if (rna.parent !== info.parent || rna.nonce !== info.nonce || rna.expires !== info.expires) {
    return "overwrite";
  }

  // 5-6. roles
  if (verifierKey === rna.editor) return "self_verify";
  if (!roles.verifier.includes(verifierKey)) return "no_role";

  // 7. content
  if (rna.append.length === 0) return "empty";

  // 8, 8a. claim shape
  for (const c of rna.append) {
    const err = claimShapeError(c);
    if (err) return err;
  }
  const append = rna.append as Claim[];

  // 9. predicate table, with supports/refutes targets
  const knownCids = new Set<string>(await Promise.all((locus?.claims ?? []).map(cid)));
  for (const c of append) {
    const err = predicateError(c);
    if (err) return err;
    if ((c.predicate === "supports" || c.predicate === "refutes") && "cid" in c.object) {
      if (!knownCids.has(c.object.cid)) return "bad_predicate";
    }
    knownCids.add(await cid(c));
  }

  // 10. parent
  const currentRoot = locus?.root ?? (await rootEmpty());
  if (rna.parent !== currentRoot) return "stale_parent";

  // 11-12. a new page needs a label; nothing repeats
  const isNew = locus === null || locus.claims.length === 0;
  if (isNew && !append.some((c) => c.predicate === "label" && c.strand === "template")) {
    return "no_label";
  }
  const have = new Set<string>(await Promise.all((locus?.claims ?? []).map(cid)));
  for (const c of append) {
    const k = await cid(c);
    if (have.has(k)) return "duplicate";
    have.add(k);
  }

  // 13-14. pins are table entries
  const templates = append.filter((c) => c.strand === "template");
  for (const c of templates) {
    if (!c.pin) return "unpinned";
    if (namespaceOf(c.subject) === "dna" && chain === null) return "unknown_locus";
    if (badSource(c)) return "bad_source";
  }

  const fetcher = new Fetcher();

  // 15. a page being created must exist at its authority
  if (isNew) {
    const label = templates.find((c) => c.predicate === "label");
    if (!label) return "no_label";
    const got = await fetcher.get(label.pin!.url);
    if (got === "too_many") return "too_large";
    if (got.state === "unavailable") return "unavailable";
    if (got.state === "absent" || pointer(got.body, label.pin!.field) === undefined) {
      return "unknown_locus";
    }
  }

  // 16-17. the pinned value still hashes, and it states the claim
  for (const c of templates) {
    const pin = c.pin!;
    const got = await fetcher.get(pin.url);
    if (got === "too_many") return "too_large";
    if (got.state === "unavailable") return "unavailable";
    if (got.state === "absent") return "evidence_mismatch";
    const value = pointer(got.body, pin.field);
    if (value === undefined) return "evidence_mismatch";
    if ((await pinDigest(value)) !== pin.digest) return "hash_drift";

    const target = pinTarget(c);
    if (!target || target.kind === "chain") return "bad_source";
    if (target.kind === "paper") {
      if (c.predicate === "cites" && "id" in c.object) {
        if (splitId(c.object.id)[1] !== target.pmid) return "evidence_mismatch";
      }
      if (String(value) !== target.pmid) return "evidence_mismatch";
      if (await attestationError(c, rna.editor, roles, true)) return "evidence_mismatch";
    } else if (!binds(c, value)) {
      return "evidence_mismatch";
    }
  }

  // 18. read ceilings and attestations
  for (const c of templates) {
    const paperRow = PAPER_PREDICATES.includes(c.predicate);
    let body: Json | null = null;
    if (paperRow) {
      const got = await fetcher.get(c.pin!.url);
      if (got === "too_many") return "too_large";
      if (got.state !== "ok") return "unavailable";
      body = got.body;
    }
    const rank = readRank(c.read);
    if (rank <= CHECKED && rank > ceilingOf(c, body)) return "read_ceiling";
    const err = await attestationError(c, rna.editor, roles, paperRow);
    if (err) return err;
  }

  // 19. the retraction gate, for every paper a template claim pins or cites
  const pmids = new Set<string>();
  for (const c of templates) {
    if (namespaceOf(c.subject) === "pmid") pmids.add(splitId(c.subject)[1]);
    if ("id" in c.object && namespaceOf(c.object.id) === "pmid") pmids.add(splitId(c.object.id)[1]);
    const target = pinTarget(c);
    if (target?.kind === "paper") pmids.add(target.pmid);
  }
  for (const pmid of pmids) {
    if (fetcher.count >= MAX_FETCHES) return "too_large";
    const verdict = await gate(pmid);
    fetcher.count += 3;
    if (verdict === "retracted") return "retracted";
    if (verdict === "unavailable") return "unavailable";
  }

  return null;
}
