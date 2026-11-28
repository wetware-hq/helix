// An editor client for skills/transcribe-page.md. It reads the 402 offer, builds one
// RNA from claims given as JSON, signs it with an Ed25519 seed and posts it.
//
//   HELIX_EDITOR_SEED=<b64url seed> node scripts/transcribe.mjs <base url> <page id> <claims.json>
//
// For a template claim with "pin": "auto", the pin is filled from the pin table: the
// pinned value is fetched and hashed (docs/pin-references.md).
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const [base, id, claimsPath] = process.argv.slice(2);
if (!base || !id || !claimsPath) {
  console.error("usage: node scripts/transcribe.mjs <base url> <page id> <claims.json>");
  process.exit(2);
}

export function jcs(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = a.charCodeAt(i) - b.charCodeAt(i);
      if (d) return d;
    }
    return a.length - b.length;
  });
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}

const sha = (s) => createHash("sha256").update(s).digest();
const seed = Buffer.from(process.env.HELIX_EDITOR_SEED ?? "", "base64url");
if (seed.length !== 32) throw new Error("HELIX_EDITOR_SEED must be a 32-byte base64url seed");
const sk = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
  format: "der",
  type: "pkcs8",
});
const editor = createPublicKey(sk).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const signObj = (x) => sign(null, sha(jcs(x)), sk).toString("base64url");

const PIN = {
  "hgnc:label": ["https://rest.genenames.org/fetch/hgnc_id/{ref}", "/response/docs/0/name"],
  "hgnc:located-at": ["https://rest.genenames.org/fetch/hgnc_id/{ref}", "/response/docs/0/location"],
  "hgnc:same-as": ["https://rest.genenames.org/fetch/hgnc_id/{ref}", "/response/docs/0/ensembl_gene_id"],
  "ensembl:label": ["https://rest.ensembl.org/lookup/id/{ref}?content-type=application/json", "/display_name"],
  "ensembl:transcribed-to": ["https://rest.ensembl.org/lookup/id/{ref}?content-type=application/json", "/canonical_transcript"],
  "ensembl:translated-to": [
    "https://rest.ensembl.org/xrefs/id/{ref}?external_db=Uniprot/SWISSPROT;all_levels=1;content-type=application/json",
    "/0/primary_id",
  ],
  "uniprot:label": ["https://rest.uniprot.org/uniprotkb/{ref}.json", "/proteinDescription/recommendedName/fullName/value"],
  "uniprot:length": ["https://rest.uniprot.org/uniprotkb/{ref}.json", "/sequence/length"],
  "pdb:label": ["https://data.rcsb.org/rest/v1/core/entry/{ref}", "/struct/title"],
  "chebi:label": ["https://www.ebi.ac.uk/chebi/backend/api/public/compound/{ref}/", "/name"],
  "pmid:label": [
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:{ref}%20AND%20SRC:MED&format=json&resultType=core",
    "/resultList/result/0/title",
  ],
};

const pointer = (doc, path) =>
  path.split("/").slice(1).reduce((cur, p) => (cur == null ? undefined : cur[p.replace(/~1/g, "/").replace(/~0/g, "~")]), doc);

async function autoPin(claim) {
  const [ns, ref] = claim.subject.split(/:(.*)/s);
  const row = PIN[ns + ":" + claim.predicate];
  if (!row) throw new Error("no pin-table row for " + ns + ":" + claim.predicate);
  const url = row[0].replace("{ref}", ref);
  const res = await fetch(url, { headers: { Accept: "application/json" }, redirect: "manual" });
  if (res.status !== 200) throw new Error(`${url}: ${res.status}`);
  const value = pointer(await res.json(), row[1]);
  if (value === undefined) throw new Error(`${url}: ${row[1]} missing`);
  return {
    pin: {
      source: ns,
      release: claim.release ?? "current",
      url,
      field: row[1],
      digest: "sha256:" + sha(jcs(value)).toString("hex"),
    },
    value,
  };
}

const claims = [];
for (const c of JSON.parse(readFileSync(claimsPath, "utf8"))) {
  const claim = { ...c, subject: id };
  delete claim.release;
  if (c.pin === "auto") {
    const { pin, value } = await autoPin({ ...c, subject: id });
    claim.pin = pin;
    if (claim.object === "auto") claim.object = { lit: String(value) };
  }
  claims.push(claim);
}

const first = await fetch(`${base}/wiki/${id}`, { method: "POST" });
if (first.status !== 402) throw new Error(`expected 402, got ${first.status}: ${await first.text()}`);
const offer = JSON.parse(Buffer.from(first.headers.get("PAYMENT-REQUIRED"), "base64").toString("utf8"));
const info = offer.extensions["helix-page"].info;

const rna = {
  id: info.id,
  editor,
  parent: info.parent,
  append: claims,
  key: randomUUID().replace(/-/g, ""),
  nonce: info.nonce,
  expires: info.expires,
};
const payload = {
  x402Version: 2,
  resource: offer.resource,
  accepted: offer.accepts[0],
  payload: { rna, sig: signObj(rna) },
  extensions: {
    "helix-page": { info: { ...info, key: rna.key } },
    "payment-identifier": { info: { required: true, id: rna.key } },
  },
};
const header = Buffer.from(JSON.stringify(payload)).toString("base64");
const res = await fetch(`${base}/wiki/${id}`, { method: "POST", headers: { "PAYMENT-SIGNATURE": header } });
console.log("status", res.status, "Helix-Root", res.headers.get("Helix-Root"));
const pr = res.headers.get("PAYMENT-RESPONSE");
if (pr) console.log(JSON.stringify(JSON.parse(Buffer.from(pr, "base64").toString("utf8")), null, 2));
console.log(await res.text());

if (process.env.HELIX_RETRY === "1" && res.status === 200) {
  const again = await fetch(`${base}/wiki/${id}`, { method: "POST", headers: { "PAYMENT-SIGNATURE": header } });
  console.log("retry status", again.status, "Helix-Root", again.headers.get("Helix-Root"));
}
