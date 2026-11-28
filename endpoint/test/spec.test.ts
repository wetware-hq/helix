import { describe, expect, it } from "vitest";
import { jcs } from "../src/lib/jcs";
import { cid, claimShapeError, predicateError, rootEmpty, rootOf, type Claim } from "../src/lib/model";
import { render } from "../src/lib/render";
import { buildIndex } from "../src/lib/og";
import { sha256hex } from "../src/lib/crypto";
import { utf8 } from "../src/lib/bytes";
import { DISCLAIMER, GENOME_SEED } from "../src/generated/static";

const label = (subject: string, lit: string): Claim => ({
  subject,
  predicate: "label",
  object: { lit },
  strand: "template",
  pin: {
    source: subject.split(":")[0],
    release: "r1",
    url: "https://rest.uniprot.org/uniprotkb/P00533.json",
    field: "/proteinDescription/recommendedName/fullName/value",
    digest: "sha256:" + "0".repeat(64),
  },
  read: "fulltext-claim-checked",
});

describe("JCS (RFC 8785)", () => {
  it("sorts keys by UTF-16 code unit and keeps JSON number form", () => {
    expect(jcs({ b: 1, a: [1, "x", null], "\u00e4": true })).toBe('{"a":[1,"x",null],"b":1,"ä":true}');
  });
});

describe("contract §3 algebra", () => {
  it("root(empty) matches systems/seal-page.md", async () => {
    expect(await rootEmpty()).toBe("9e870b27ebdb0df84bcb5d4391a72e17b5eccfb75af047d179523fd285672799");
  });

  it("folds every root in genome.json", async () => {
    for (const [id, locus] of Object.entries(GENOME_SEED.loci)) {
      expect(await rootOf(locus.claims), id).toBe(locus.root);
    }
  });

  it("gives one cid per claim regardless of attestations", async () => {
    const c = label("uniprot:P00533", "EGFR");
    const withAttest: Claim = { ...c, attest: [{ reader: "k", read: "second-read", sig: "s" }] };
    expect(await cid(withAttest)).toBe(await cid(c));
  });
});

describe("claim validation", () => {
  it("refuses a field outside §1 with reverse_flow", () => {
    const c = { ...label("uniprot:P00533", "EGFR"), markdown: "# page" };
    expect(claimShapeError(c)).toBe("reverse_flow");
  });

  it("refuses an unpinned template claim", () => {
    expect(claimShapeError({ ...label("uniprot:P00533", "EGFR"), pin: null })).toBe("unpinned");
  });

  it("refuses a scratch label and a template plan", () => {
    expect(predicateError({ ...label("uniprot:P00533", "x"), strand: "scratch", pin: null, read: "unread" })).toBe(
      "bad_predicate",
    );
  });

  it("rejects the removed predicates", () => {
    const subject = "dna:" + "a".repeat(32);
    const claims: Claim[] = [
      { subject, predicate: "view", object: { lit: "size=1 #" }, strand: "scratch", pin: null, read: "unread" },
      {
        subject,
        predicate: "held-by",
        object: { lit: "eip155:1:0x" + "a".repeat(40) },
        strand: "template",
        pin: null,
        read: "unread",
      },
      { subject, predicate: "prints", object: { lit: "1" }, strand: "template", pin: null, read: "unread" },
      { subject, predicate: "encodes", object: { id: "uniprot:P00533" }, strand: "template", pin: null, read: "unread" },
    ];
    for (const c of claims) expect(predicateError(c)).toBe("bad_predicate");
  });

  it("refuses a label literal holding markdown", () => {
    expect(predicateError(label("uniprot:P00533", "see [this](/wiki/x)"))).toBe("bad_predicate");
  });
});

describe("rendering", () => {
  it("renders the EGFR protein page from genome.json", async () => {
    const id = "uniprot:P00533";
    const page = await render(id, GENOME_SEED.loci[id], DISCLAIMER);
    expect(page).toContain("# `uniprot:P00533`");
    expect(page).toContain("name: `Epidermal growth factor receptor`");
    expect(page).toContain("## Facts\n- `uniprot:P00533` is named `Epidermal growth factor receptor`");
    expect(page).toContain("- `uniprot:P00533` has length `1210`");
    expect(page).toContain(
      "## Hypotheses (not evidence)\n- `uniprot:P00533` binds [`uniprot:P01133`](/wiki/uniprot:P01133)",
    );
    expect(page.endsWith("licence: MIT\n")).toBe(true);
    expect(await render(id, GENOME_SEED.loci[id], DISCLAIMER)).toBe(page);
  });

  it("keeps a refuted claim on the page and out of Facts", async () => {
    const claims = GENOME_SEED.loci["uniprot:P00533"].claims.slice(0, 2);
    const target = await cid(claims[1]);
    const refutation: Claim = {
      subject: "uniprot:P00533",
      predicate: "refutes",
      object: { cid: target },
      strand: "template",
      pin: {
        source: "pmid",
        release: "r1",
        url: "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:1%20AND%20SRC:MED&format=json&resultType=core",
        field: "/resultList/result/0/pmid",
        digest: "sha256:" + "0".repeat(64),
      },
      read: "fulltext-claim-checked",
    };
    const locus = { claims: [...claims, refutation], root: "r" };
    const page = await render("uniprot:P00533", locus, DISCLAIMER);
    expect(page).toContain("## Refuted\n- `uniprot:P00533` has length `1210` (fulltext-claim-checked, template)");
    expect(page).not.toContain("## Facts\n- `uniprot:P00533` has length");
  });
});

describe("index", () => {
  it("rebuilds ooc/helix.og with a matching checksum", async () => {
    const og = await buildIndex(GENOME_SEED, "2026-11-28");
    const line = /checksum: sha256:([0-9a-f]{64})/.exec(og)!;
    const without = og
      .split("\n")
      .filter((l) => !l.startsWith("checksum:"))
      .join("\n");
    expect(await sha256hex(utf8(without))).toBe(line[1]);
    expect(og).toContain("::node [id=uniprot:P00533 type=page");
    expect(og).toContain("->[:hypothesis] uniprot:P01133");
    expect(og).toContain("->[:same-as] ensembl:ENSG00000146648");
  });
});

import { isKey } from "../src/lib/crypto";
describe("keys", () => {
  it("accepts one spelling per Ed25519 key", () => {
    const key = "rqtfDp9sW2dLoSo0OVxwttCPr7isVreCpr5BUbS4NKg";
    expect(isKey(key)).toBe(true);
    expect(isKey(key.slice(0, 42) + "h")).toBe(false);
  });
});

describe("refutation chains", () => {
  const pin = (n: string) => ({
    source: "pmid",
    release: "r1",
    url: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:${n}%20AND%20SRC:MED&format=json&resultType=core`,
    field: "/resultList/result/0/pmid",
    digest: "sha256:" + "0".repeat(64),
  });
  const refute = (target: string, n: string, read: Claim["read"]): Claim => ({
    subject: "uniprot:P00533",
    predicate: "refutes",
    object: { cid: target },
    strand: "template",
    pin: pin(n),
    read,
  });

  it("renders an overturned checked refutation as refuted, not as a fact", async () => {
    const base = GENOME_SEED.loci["uniprot:P00533"].claims.slice(0, 2);
    const a = refute(await cid(base[1]), "1", "fulltext-claim-checked");
    const b = refute(await cid(a), "2", "fulltext-claim-checked");
    const page = await render("uniprot:P00533", { claims: [...base, a, b], root: "r" }, DISCLAIMER);
    const facts = page.split("## Facts")[1].split("\n\n")[0];
    expect(facts).toContain("has length `1210`");
    expect(facts).not.toContain(a.object && "cid" in a.object ? a.object.cid : "x");
    expect(page).toContain("## Refuted\n- `uniprot:P00533` refutes `" + (a.object as { cid: string }).cid);
  });

  it("indexes a disputed relationship as a hypothesis", async () => {
    const claims = GENOME_SEED.loci["hgnc:3236"].claims;
    const d = refute(await cid(claims[2]), "3", "abstract-read");
    const og = await buildIndex(
      { ...GENOME_SEED, loci: { "hgnc:3236": { claims: [...claims, d], root: "r" } } },
      "2026-11-28",
    );
    expect(og).toContain("->[:hypothesis] ensembl:ENSG00000146648");
    expect(og).not.toContain("->[:same-as] ensembl:ENSG00000146648");
  });
});
