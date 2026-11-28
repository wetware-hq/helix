// systems/serve-endpoint.md §Rendering: protein is made from DNA at request time.
import { CHECKED, cid, namespaceOf, readRank, type Claim, type Locus } from "./model";

export const RENDERER = "1";

const VERB: Record<string, string> = {
  "same-as": "is the same as",
  "located-at": "is located at",
  "transcribed-to": "is transcribed to",
  "translated-to": "is translated to",
  encodes: "encodes",
  "part-of": "is part of",
  binds: "binds",
  cites: "cites",
  supports: "supports",
  refutes: "refutes",
  length: "has length",
  "held-by": "is held by",
  "sequence-root": "has sequence root",
  prints: "has print count",
  printed: "printed",
  plan: "would be built by",
  view: "is expected to look like",
  label: "is named",
};

function objectText(c: Claim): string {
  if ("id" in c.object) return "[`" + c.object.id + "`](/wiki/" + c.object.id + ")";
  if ("cid" in c.object) return "`" + c.object.cid + "`";
  return "`" + c.object.lit + "`";
}

function line(c: Claim): string {
  return "- `" + c.subject + "` " + VERB[c.predicate] + " " + objectText(c);
}

function blockNumber(c: Claim): number {
  const m = /^block (\d+)$/.exec(c.pin?.release ?? "");
  return m ? Number(m[1]) : -1;
}

export type Sections = {
  counted: boolean[];
  refuted: Set<number>;
  disputed: Set<number>;
  superseded: Set<number>;
};

/**
 * contract §4: a refutation is counted unless a counted refutation with equal or higher
 * read targets it. A claim can only target earlier claims, so one pass from the last
 * claim to the first decides this.
 */
export async function classify(claims: Claim[]): Promise<Sections> {
  const cids = await Promise.all(claims.map(cid));
  const index = new Map<string, number>();
  cids.forEach((c, i) => {
    if (!index.has(c)) index.set(c, i);
  });

  const live = claims.map((c) => c.strand === "template");
  const refuted = new Set<number>();
  const disputed = new Set<number>();
  for (let i = claims.length - 1; i >= 0; i--) {
    const c = claims[i];
    if (c.predicate !== "refutes" || !live[i]) continue;
    const target = index.get(("cid" in c.object ? c.object.cid : "") as string);
    if (target === undefined) continue;
    if (claims[target].predicate === "refutes" && readRank(c.read) >= readRank(claims[target].read)) {
      live[target] = false;
    }
    if (readRank(c.read) >= CHECKED) refuted.add(target);
    else disputed.add(target);
  }
  for (const i of refuted) disputed.delete(i);
  // serve-endpoint §Rendering: counted := template, and not the target of a counted refutes claim.
  const counted = claims.map((c, i) => c.strand === "template" && !refuted.has(i) && !disputed.has(i));

  // A counted held-by or prints claim on a dna: page is superseded by a counted claim of
  // the same predicate pinned at a higher block.
  const superseded = new Set<number>();
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    if (!counted[i] || namespaceOf(c.subject) !== "dna") continue;
    if (c.predicate !== "held-by" && c.predicate !== "prints") continue;
    const mine = blockNumber(c);
    const higher = claims.some(
      (o, j) => counted[j] && o.predicate === c.predicate && blockNumber(o) > mine,
    );
    if (higher) superseded.add(i);
  }
  return { counted, refuted, disputed, superseded };
}

export async function render(id: string, locus: Locus, disclaimer: string): Promise<string> {
  const claims = locus.claims;
  const { counted, refuted, disputed, superseded } = await classify(claims);
  const plain = (i: number) => !refuted.has(i) && !disputed.has(i) && !superseded.has(i);

  const header: string[] = ["# `" + id + "`"];
  claims.forEach((c, i) => {
    if (c.predicate !== "label" || !counted[i]) return;
    const lit = "lit" in c.object ? c.object.lit : "";
    header.push("name: `" + lit + "`" + (readRank(c.read) < CHECKED ? " (" + c.read + ")" : ""));
  });
  header.push("root: `" + locus.root + "`");

  const facts: string[] = [];
  const partial: string[] = [];
  const history: string[] = [];
  const refutedLines: string[] = [];
  const disputedLines: string[] = [];
  const hypotheses: string[] = [];

  claims.forEach((c, i) => {
    const template = c.strand === "template";
    if (refuted.has(i)) {
      refutedLines.push(line(c) + " (" + c.read + ", " + c.strand + ")");
      return;
    }
    if (disputed.has(i)) {
      disputedLines.push(line(c) + " (" + c.read + ", " + c.strand + ")");
      return;
    }
    if (superseded.has(i)) {
      history.push(line(c) + " (" + (c.pin?.release ?? "") + ")");
      return;
    }
    if (!template) {
      hypotheses.push(line(c));
      return;
    }
    if (readRank(c.read) >= CHECKED) facts.push(line(c));
    else partial.push(line(c) + " (" + c.read + ")");
    void plain;
  });

  const blocks: string[] = [header.join("\n")];
  const section = (title: string, lines: string[]) => {
    if (lines.length) blocks.push([title, ...lines].join("\n"));
  };
  section("## Facts", facts);
  section("## Partial", partial);
  section("## History", history);
  section("## Refuted", refutedLines);
  section("## Disputed", disputedLines);
  section("## Hypotheses (not evidence)", hypotheses);
  blocks.push(["---", disclaimer, "root: " + locus.root, "licence: MIT"].join("\n"));
  return blocks.join("\n\n") + "\n";
}
