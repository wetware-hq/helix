// systems/seal-page.md: ooc/helix.og is derived and rebuilt from the genome.
import { CHECKED, readRank, type Claim, type Genome } from "./model";
import { classify } from "./render";
import { OG } from "../generated/static";
import { sha256hex } from "./crypto";
import { utf8 } from "./bytes";

function labelOf(claims: Claim[], counted: boolean[]): string {
  for (let i = claims.length - 1; i >= 0; i--) {
    const c = claims[i];
    if (c.predicate === "label" && counted[i] && "lit" in c.object) return c.object.lit;
  }
  return "";
}

function keywords(label: string): string {
  return label.toLowerCase() || "page";
}

async function pageNode(id: string, claims: Claim[], root: string, updated: string): Promise<string> {
  const { counted } = await classify(claims);
  const label = labelOf(claims, counted);
  const edges: string[] = [];
  claims.forEach((c, i) => {
    if (!("id" in c.object)) return;
    const fact = counted[i] && readRank(c.read) >= CHECKED;
    edges.push("->[:" + (fact ? c.predicate : "hypothesis") + "] " + c.object.id);
  });
  return [
    `::node [id=${id} type=page confidence=1.00 scope=all updated=${updated}]`,
    "::dense",
    `root:${root}|claims:${claims.length}`,
    "::end",
    "::full",
    `${label}. GET /wiki/${id}`,
    "::end",
    "::edges",
    ...edges,
    "::end",
    "::end",
  ].join("\n");
}

/** Rebuild the index. `updated` is the YYYY-MM-DD the genome last changed. */
export async function buildIndex(genome: Genome, updated: string): Promise<string> {
  const ids = Object.keys(genome.loci);
  const indexRows = await Promise.all(
    ids.map(async (id) => {
      const locus = genome.loci[id];
      const { counted } = await classify(locus.claims);
      return `${id} | page | all | 1.00 | ${keywords(labelOf(locus.claims, counted))}`;
    }),
  );
  const nodes = await Promise.all(
    ids.map((id) => pageNode(id, genome.loci[id].claims, genome.loci[id].root, updated)),
  );

  const body = [
    "::meta",
    ...OG.meta,
    `updated: ${updated}`,
    "checksum: sha256:__CHECKSUM__",
    "::end",
    "",
    "::schema",
    ...OG.schema,
    "::end",
    "",
    "::index",
    ...OG.indexPre,
    ...indexRows,
    ...OG.indexPost,
    "::end",
    "",
    ...OG.nodesPre.flatMap((n) => [n, ""]),
    ...nodes.flatMap((n) => [n, ""]),
    ...OG.nodesPost.flatMap((n) => [n, ""]),
  ].join("\n");

  const withoutChecksum = body
    .split("\n")
    .filter((l) => !l.startsWith("checksum:"))
    .join("\n");
  const checksum = await sha256hex(utf8(withoutChecksum));
  return body.replace("__CHECKSUM__", checksum);
}
