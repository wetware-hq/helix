// The helix data model: IDs (contract §0), the three molecules (§1), the algebra (§3)
// and the predicate table (§3). Codes are the contract's §5 refusal codes.
import { jcs, type Json } from "./jcs";
import { digestHex, isKey, sha256hex } from "./crypto";
import { utf8 } from "./bytes";

export type Code =
  | "bad_envelope" | "expired" | "bad_id" | "unknown_locus" | "replay" | "stale_parent"
  | "overwrite" | "empty" | "no_label" | "duplicate" | "bad_predicate" | "reverse_flow"
  | "bad_claim" | "too_large" | "bad_source" | "unsafe" | "unpinned" | "hash_drift"
  | "evidence_mismatch" | "read_ceiling" | "retracted" | "self_verify" | "no_role" | "unavailable";

export const READS = [
  "unread", "metadata-only", "abstract-read", "fulltext-claim-checked", "second-read", "human-oracle",
] as const;
export type ReadStatus = (typeof READS)[number];
export const CHECKED = READS.indexOf("fulltext-claim-checked");
export function readRank(r: string): number {
  return READS.indexOf(r as ReadStatus);
}

export const NAMESPACES: Record<string, RegExp> = {
  hgnc: /^[1-9][0-9]*$/,
  ensembl: /^ENS[GT][0-9]{11}$/,
  uniprot: /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/,
  pdb: /^[1-9][A-Z0-9]{3}$/,
  chebi: /^[1-9][0-9]*$/,
  pmid: /^[1-9][0-9]*$/,
  dna: /^[0-9a-f]{32}$/,
};

const ID_SHAPE = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
export const CID = /^cid:[0-9a-f]{64}$/;
export const HEX64 = /^[0-9a-f]{64}$/;

export function isId(s: unknown): s is string {
  if (typeof s !== "string" || !ID_SHAPE.test(s)) return false;
  const [ns, ref] = splitId(s);
  const pattern = NAMESPACES[ns];
  return pattern !== undefined && pattern.test(ref);
}

export function splitId(id: string): [string, string] {
  const i = id.indexOf(":");
  return [id.slice(0, i), id.slice(i + 1)];
}

export function namespaceOf(id: string): string {
  return splitId(id)[0];
}

export type Obj = { id: string } | { cid: string } | { lit: string };
export type Attestation = { reader: string; read: ReadStatus; sig: string };
export type Pin = { source: string; release: string; url: string; field: string; digest: string };
export type Claim = {
  subject: string;
  predicate: string;
  object: Obj;
  strand: "template" | "scratch";
  pin: Pin | null;
  read: ReadStatus;
  attest?: Attestation[];
};
export type Locus = { claims: Claim[]; root: string };
export type Roles = {
  endpoint: string[]; verifier: string[]; sealer: string[]; reader: string[]; oracle: string[];
};
export type Chain = { network: string; contract: string; rpc: string } | null;
export type Receipt = {
  rna: string; id: string; root: string; editor: string; verifier: string; sealer: string; at: string;
};
export type Genome = {
  helix: 1;
  roles: Roles;
  chain: Chain;
  loci: Record<string, Locus>;
  receipts: Record<string, { rna: string; response: Json }>;
  spent: Record<string, string>;
};
export type Rna = {
  id: string; editor: string; parent: string; append: Claim[];
  key: string; nonce: string; expires: string;
};

const CLAIM_FIELDS = ["subject", "predicate", "object", "strand", "pin", "read", "attest"];
const PIN_FIELDS = ["source", "release", "url", "field", "digest"];
const RNA_FIELDS = ["id", "editor", "parent", "append", "key", "nonce", "expires"];
const ATTEST_FIELDS = ["reader", "read", "sig"];

type Rule = {
  kind: "lit" | "id" | "cid";
  strand?: "template" | "scratch";
  dnaOnly?: boolean;
  lit?: RegExp;
  idNamespace?: string;
};

export const PREDICATES: Record<string, Rule> = {
  label: { kind: "lit", strand: "template" },
  "located-at": { kind: "lit", lit: /^[0-9XY]{1,2}[pq][0-9.]+$/ },
  length: { kind: "lit", lit: /^[1-9][0-9]*$/ },
  "held-by": { kind: "lit", strand: "template", dnaOnly: true, lit: /^eip155:[0-9]{1,32}:0x[0-9a-f]{40}$/ },
  "sequence-root": { kind: "lit", strand: "template", dnaOnly: true, lit: HEX64 },
  prints: { kind: "lit", strand: "template", dnaOnly: true, lit: /^(0|[1-9][0-9]*)$/ },
  printed: { kind: "lit", strand: "template", dnaOnly: true, lit: /^[1-9][0-9]*:[0-9a-f]{64}$/ },
  plan: {
    kind: "lit", strand: "scratch", dnaOnly: true,
    lit: /^tess1:[0-9a-f]{64} [a-z0-9][a-z0-9-]{1,30} [1-9][0-9]{0,5}$/,
  },
  view: { kind: "lit", strand: "scratch", dnaOnly: true },
  "same-as": { kind: "id" },
  "transcribed-to": { kind: "id" },
  "translated-to": { kind: "id" },
  encodes: { kind: "id" },
  "part-of": { kind: "id" },
  binds: { kind: "id" },
  cites: { kind: "id", idNamespace: "pmid" },
  supports: { kind: "cid", strand: "template" },
  refutes: { kind: "cid", strand: "template" },
};

const LABEL_LIT = /^[^`<>\[\]|\n]{1,300}$/;
const VIEW = /^size=([1-8]) ([ .:=+*#%@-]{1,8}(?:\/[ .:=+*#%@-]{1,8}){0,7})$/;

export function labelLitOk(lit: string): boolean {
  // 1-300 printable characters, none of ` < > [ ] | or a newline.
  if (!LABEL_LIT.test(lit)) return false;
  return ![...lit].some((ch) => {
    const c = ch.codePointAt(0)!;
    return c < 0x20 || c === 0x7f;
  });
}

export function viewOk(lit: string): boolean {
  const m = VIEW.exec(lit);
  if (!m) return false;
  const side = Number(m[1]);
  const rows = m[2].split("/");
  return rows.length === side && rows.every((r) => [...r].length === side);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** §5 bad_claim: shape, strand/read enums, pin grammar and attestation shape. */
export function claimShapeError(c: unknown): Code | null {
  if (!isObject(c)) return "bad_claim";
  for (const k of Object.keys(c)) if (!CLAIM_FIELDS.includes(k)) return "reverse_flow";
  for (const k of ["subject", "predicate", "object", "strand", "read"]) {
    if (!(k in c)) return "bad_claim";
  }
  if (!("pin" in c)) return "bad_claim";
  if (typeof c.subject !== "string" || typeof c.predicate !== "string") return "bad_claim";
  if (c.strand !== "template" && c.strand !== "scratch") return "bad_claim";
  if (typeof c.read !== "string" || readRank(c.read) < 0) return "bad_claim";
  if (!isObject(c.object) || Object.keys(c.object).length !== 1) return "bad_claim";
  const key = Object.keys(c.object)[0];
  if (!["id", "cid", "lit"].includes(key) || typeof (c.object as Record<string, unknown>)[key] !== "string") {
    return "bad_claim";
  }
  if (c.strand === "template") {
    if (c.read === "unread") return "bad_claim";
    if (!isObject(c.pin)) return "unpinned";
  } else {
    if (c.pin !== null) return "bad_claim";
    if (c.read !== "unread") return "bad_claim";
  }
  if (c.pin !== null) {
    const p = c.pin as Record<string, unknown>;
    if (Object.keys(p).length !== PIN_FIELDS.length) return "bad_claim";
    for (const k of PIN_FIELDS) if (typeof p[k] !== "string") return "bad_claim";
    if (!(p.source as string in NAMESPACES)) return "bad_claim";
    if (!/^[A-Za-z0-9 ._:-]{1,48}$/.test(p.release as string)) return "bad_claim";
    if (!/^https:\/\/[^\s]+$/.test(p.url as string)) return "bad_claim";
    if (!/^(\/[^\s/]*)+$/.test(p.field as string)) return "bad_claim";
    if (!/^sha256:[0-9a-f]{64}$/.test(p.digest as string)) return "bad_claim";
  }
  if ("attest" in c) {
    if (!Array.isArray(c.attest) || c.attest.length === 0) return "bad_claim";
    if (c.attest.length > 4) return "too_large";
    for (const a of c.attest) {
      if (!isObject(a) || Object.keys(a).length !== ATTEST_FIELDS.length) return "bad_claim";
      if (!isKey(a.reader) || typeof a.sig !== "string") return "bad_claim";
      if (typeof a.read !== "string" || readRank(a.read) < 0) return "bad_claim";
    }
  }
  return null;
}

/** §3 predicate table: predicate, object kind and literal. */
export function predicateError(c: Claim): Code | null {
  const rule = PREDICATES[c.predicate];
  if (!rule) return "bad_predicate";
  if (rule.strand && c.strand !== rule.strand) return "bad_predicate";
  if (rule.dnaOnly && namespaceOf(c.subject) !== "dna") return "bad_predicate";
  if (rule.kind === "id") {
    if (!("id" in c.object) || !isId(c.object.id)) return "bad_id";
    if (rule.idNamespace && namespaceOf(c.object.id) !== rule.idNamespace) return "bad_predicate";
    return null;
  }
  if (rule.kind === "cid") {
    if (!("cid" in c.object) || !CID.test(c.object.cid)) return "bad_predicate";
    return null;
  }
  if (!("lit" in c.object)) return "bad_predicate";
  const lit = c.object.lit;
  if (c.predicate === "label") return labelLitOk(lit) ? null : "bad_predicate";
  if (c.predicate === "view") return viewOk(lit) ? null : "bad_predicate";
  if (rule.lit && !rule.lit.test(lit)) return "bad_predicate";
  return null;
}

// §3 algebra.
export function core(c: Claim): Json {
  const { attest, ...rest } = c;
  return rest as unknown as Json;
}

export async function cid(c: Claim): Promise<string> {
  return "cid:" + (await digestHex(core(c)));
}

export async function chash(c: Claim): Promise<string> {
  return digestHex(c as unknown as Json);
}

export const ROOT_EMPTY_INPUT = "helix/1";

export async function rootEmpty(): Promise<string> {
  return sha256hex(utf8(ROOT_EMPTY_INPUT));
}

/** root(w · c) = hex(sha256(root(w) || chash(c))), the two hex strings joined as UTF-8. */
export async function foldRoot(root: string, c: Claim): Promise<string> {
  return sha256hex(utf8(root + (await chash(c))));
}

export async function rootOf(claims: Claim[]): Promise<string> {
  let root = await rootEmpty();
  for (const c of claims) root = await foldRoot(root, c);
  return root;
}

export function jcsBytes(x: Json): Uint8Array {
  return utf8(jcs(x));
}

export const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** §1 RNA shape. */
export function rnaShapeOk(rna: unknown): rna is Rna {
  if (!isObject(rna)) return false;
  const keys = Object.keys(rna);
  if (keys.length !== RNA_FIELDS.length || !RNA_FIELDS.every((k) => keys.includes(k))) return false;
  return (
    typeof rna.id === "string" &&
    isKey(rna.editor) &&
    typeof rna.parent === "string" && HEX64.test(rna.parent) &&
    Array.isArray(rna.append) &&
    typeof rna.key === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(rna.key) &&
    typeof rna.nonce === "string" && /^[0-9a-f]{64}$/.test(rna.nonce) &&
    typeof rna.expires === "string" && TIME.test(rna.expires)
  );
}

export function emptyGenomeRoles(): Roles {
  return { endpoint: [], verifier: [], sealer: [], reader: [], oracle: [] };
}
