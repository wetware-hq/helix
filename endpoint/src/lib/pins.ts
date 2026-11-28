// docs/pin-references.md: the pin table, the fetch rules, binds, source ceilings,
// attestations and the three-source retraction gate.
import { jcs, type Json } from "./jcs";
import { sha256hex, verifyObject } from "./crypto";
import { utf8 } from "./bytes";
import {
  CHECKED, core, namespaceOf, readRank, splitId, type Claim, type Code, type Roles,
} from "./model";

export const PAPER_PREDICATES = ["cites", "supports", "refutes", "binds", "part-of"];

const EUROPEPMC = (pmid: string) =>
  "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:" +
  pmid +
  "%20AND%20SRC:MED&format=json&resultType=core";

type Row = { url: (ref: string) => string; field: string };

const TABLE: Record<string, Record<string, Row>> = {
  hgnc: {
    label: { url: (r) => `https://rest.genenames.org/fetch/hgnc_id/${r}`, field: "/response/docs/0/name" },
    "located-at": { url: (r) => `https://rest.genenames.org/fetch/hgnc_id/${r}`, field: "/response/docs/0/location" },
    "same-as": { url: (r) => `https://rest.genenames.org/fetch/hgnc_id/${r}`, field: "/response/docs/0/ensembl_gene_id" },
  },
  ensembl: {
    label: {
      url: (r) => `https://rest.ensembl.org/lookup/id/${r}?content-type=application/json`,
      field: "/display_name",
    },
    "transcribed-to": {
      url: (r) => `https://rest.ensembl.org/lookup/id/${r}?content-type=application/json`,
      field: "/canonical_transcript",
    },
    "translated-to": {
      url: (r) =>
        `https://rest.ensembl.org/xrefs/id/${r}?external_db=Uniprot/SWISSPROT;all_levels=1;content-type=application/json`,
      field: "/0/primary_id",
    },
  },
  uniprot: {
    label: {
      url: (r) => `https://rest.uniprot.org/uniprotkb/${r}.json`,
      field: "/proteinDescription/recommendedName/fullName/value",
    },
    length: { url: (r) => `https://rest.uniprot.org/uniprotkb/${r}.json`, field: "/sequence/length" },
  },
  pdb: {
    label: { url: (r) => `https://data.rcsb.org/rest/v1/core/entry/${r}`, field: "/struct/title" },
  },
  chebi: {
    label: {
      url: (r) => `https://www.ebi.ac.uk/chebi/backend/api/public/compound/${r}/`,
      field: "/name",
    },
  },
  pmid: {
    label: { url: EUROPEPMC, field: "/resultList/result/0/title" },
  },
};

export type PinTarget =
  | { kind: "record"; url: string; field: string }
  | { kind: "paper"; url: string; field: string; pmid: string }
  | { kind: "chain" };

/** The pin a claim must carry, or null when the claim's pin is not a table entry. */
export function pinTarget(c: Claim): PinTarget | null {
  const [ns, ref] = splitId(c.subject);
  if (ns === "dna") return { kind: "chain" };
  if (PAPER_PREDICATES.includes(c.predicate)) {
    const m = /EXT_ID:([1-9][0-9]*)%20AND%20SRC:MED/.exec(c.pin?.url ?? "");
    if (!m) return null;
    return { kind: "paper", url: EUROPEPMC(m[1]), field: "/resultList/result/0/pmid", pmid: m[1] };
  }
  const row = TABLE[ns]?.[c.predicate];
  if (!row) return null;
  return { kind: "record", url: row.url(ref), field: row.field };
}

/** Step 14: pin.source, url and field must equal the table entry for this claim. */
export function badSource(c: Claim): boolean {
  const target = pinTarget(c);
  if (!target || target.kind === "chain") return true;
  const pin = c.pin!;
  const wantSource = target.kind === "paper" ? "pmid" : namespaceOf(c.subject);
  return pin.source !== wantSource || pin.url !== target.url || pin.field !== target.field;
}

export type Fetched =
  | { state: "ok"; body: Json }
  | { state: "absent" }
  | { state: "unavailable" };

const LIMIT = 1024 * 1024;

export async function fetchJson(url: string): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "helix-endpoint/1" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { state: "unavailable" };
  }
  if (res.status === 400 || res.status === 404 || res.status === 410) return { state: "absent" };
  if (res.status !== 200) return { state: "unavailable" };
  const text = await readCapped(res);
  if (text === null) return { state: "unavailable" };
  try {
    return { state: "ok", body: JSON.parse(text) as Json };
  } catch {
    return { state: "unavailable" };
  }
}

async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMIT) {
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

/** RFC 6901 JSON pointer; undefined when the pointer is missing. */
export function pointer(doc: Json, path: string): Json | undefined {
  let cur: Json | undefined = doc;
  for (const rawPart of path.split("/").slice(1)) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(part)) return undefined;
      cur = cur[Number(part)];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, Json>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

export async function pinDigest(value: Json): Promise<string> {
  return "sha256:" + (await sha256hex(utf8(jcs(value))));
}

export function stripVersion(s: string): string {
  return s.replace(/\.[0-9]+$/, "");
}

/** binds(c): does the pinned value state the claim's object? */
export function binds(c: Claim, value: Json): boolean {
  if ("lit" in c.object) return litOf(value) === c.object.lit;
  if ("id" in c.object) {
    const got = litOf(value);
    return got !== null && stripVersion(got) === splitId(c.object.id)[1];
  }
  return false;
}

function litOf(value: Json): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export type Evidence = {
  /** Highest read the source allows, before attestations. */
  ceiling: number;
};

/** Source ceilings. Papers depend on Europe PMC isOpenAccess. */
export function ceilingOf(c: Claim, paperBody: Json | null): number {
  if (namespaceOf(c.subject) === "pmid" && c.predicate === "label") return CHECKED;
  if (PAPER_PREDICATES.includes(c.predicate)) {
    const open = pointer(paperBody ?? null, "/resultList/result/0/isOpenAccess");
    return open === "Y" ? CHECKED : readRank("abstract-read");
  }
  return CHECKED;
}

/** Attestations required by docs/pin-references.md, and their signatures. */
export async function attestationError(
  c: Claim,
  editor: string,
  roles: Roles,
  isPaperRow: boolean,
): Promise<Code | null> {
  const attest = c.attest ?? [];
  if (attest.some((a) => a.reader === editor)) return "read_ceiling";
  const coreHex = await sha256hex(utf8(jcs(core(c))));
  for (const a of attest) {
    const ok = await verifyObject(a.reader, a.sig, { core: coreHex, read: a.read });
    if (!ok) return "read_ceiling";
  }
  const rank = readRank(c.read);
  if (c.read === "human-oracle") {
    const ok = attest.some((a) => a.read === "human-oracle" && roles.oracle.includes(a.reader));
    return ok ? null : "read_ceiling";
  }
  if (c.read === "second-read") {
    const keys = new Set(
      attest.filter((a) => a.read === "second-read" && roles.reader.includes(a.reader)).map((a) => a.reader),
    );
    return keys.size >= 2 ? null : "read_ceiling";
  }
  if (isPaperRow && rank <= CHECKED) {
    const ok = attest.some((a) => a.read === c.read && roles.reader.includes(a.reader));
    return ok ? null : "read_ceiling";
  }
  return null;
}

export type Get = (url: string) => Promise<Fetched | "too_many">;

/** The three-source retraction gate; `get` counts and caches the edit's fetches. */
export async function gate(pmid: string, get: Get): Promise<"clear" | "retracted" | "unavailable" | "too_large"> {
  const e = await get(EUROPEPMC(pmid));
  if (e === "too_many") return "too_large";
  if (e.state === "unavailable") return "unavailable";
  if (e.state === "absent") return "unavailable";
  const result = pointer(e.body, "/resultList/result/0");
  if (result === undefined) return "unavailable";
  const pubTypes = pointer(result, "/pubTypeList/pubType");
  const types = Array.isArray(pubTypes) ? pubTypes : pubTypes === undefined ? [] : [pubTypes];
  if (types.some((t) => t === "Retracted Publication")) return "retracted";

  const openalex = await get(`https://api.openalex.org/works/pmid:${pmid}`);
  if (openalex === "too_many") return "too_large";
  if (openalex.state === "unavailable") return "unavailable";
  if (openalex.state === "ok" && pointer(openalex.body, "/is_retracted") === true) return "retracted";

  const doi = pointer(result, "/doi");
  if (typeof doi !== "string" || !/^10\.[0-9]{4,9}\/[-._;()/:A-Za-z0-9]+$/.test(doi)) {
    return typeof doi === "string" ? "unavailable" : "clear";
  }
  const crossref = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (crossref === "too_many") return "too_large";
  if (crossref.state === "unavailable") return "unavailable";
  if (crossref.state === "ok") {
    const updatedBy = pointer(crossref.body, "/message/updated-by");
    if (Array.isArray(updatedBy) && updatedBy.some((u) => pointer(u, "/type") === "retraction")) {
      return "retracted";
    }
  }
  return "clear";
}
