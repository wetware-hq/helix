# `pace-frontier` — the campaign fleet over helix

`type: resource.campaign` · `spec: agent.fleet` · subordinate to `docs/follow-agent-contract.md`, which governs on any conflict.

A **campaign** is a standing fleet that works one frontier of synthetic biology and leaves its checkable residue in helix. The fleet itself lives in `wetware-hq/bell`; the research loop lives in `wetware-hq/popper`; the forum lives in `wetware-hq/agora`. This file is the helix side of that arrangement: what a campaign is, what it may send here, and what counts as pacing the frontier.

This is a fleet specification only. There is no runner in this repository, and a campaign gains no privilege here: it edits through the same `402` → verify → settle flow as any other agent (`systems/serve-endpoint.md`).

## Specification

```json { type: notebook.cell }
{
  "id": "campaigns/pace-frontier.md",
  "type": "resource.campaign",
  "role": "define a campaign, its lanes, its manifest and the pace metric",
  "reads": ["campaigns/<id>.json", "bell Mission", "popper trace", "agora board"],
  "writes": [],
  "must": ["a campaign is an editor key, never a role key", "one frontier per campaign", "no prose reaches a claim", "every artefact passes the gate before it is transcribed"],
  "check": ["C1-C7", "H3", "H8", "H9"]
}
```

## Graph

- ← [../docs/follow-agent-contract.md](../docs/follow-agent-contract.md)
- → [commit-artefact.md](commit-artefact.md)
- → [../skills/transcribe-page.md](../skills/transcribe-page.md)

## Indications

- A steward wants continuous work on one frontier (a function in a compartment) rather than one-off edits.
- A fleet has released an artefact and needs to know what may be said about it here, and how.

## Contraindications

- Not a way to bulk-import a literature search. Each claim still needs its own pin and read status.
- Not a second store. A campaign's memos, conjectures, traces and board casts stay in `bell`, `popper` and `agora`; helix holds only pinned claims.
- Not a scheduler. Turn length, GPU count and lane count are deployment choices, set in the manifest, never policy here.

## Frontier

A frontier is named by three fields, after the worked examples in WET-138:

```text { type: notebook.cell }
Frontier = { function: Function, compartment: Compartment, exemplar: Pmid }
Function     = sensory | motor | communication | metabolic | structural | regulatory
Compartment  = membrane | cytosol | nucleus | golgi | mitochondrion | wall | matrix
Pmid         = ^pmid:[1-9][0-9]*$
```

The exemplar is one published construct that already does the function in that compartment: a programmable receptor at the membrane, a molecular recorder in the nucleus, a typable transporter through the Golgi. It is a `pmid:` page here, so the first act of a campaign is to create or read that page, and the frontier is thereby checkable: a campaign whose exemplar is unresolvable at its authority is refused with `off_frontier` before any lane starts.

A preprint reached by DOI is resolved to its `pmid:` through `skills/resolve-locus.md`: Europe PMC answers a preprint record with a `Preprint of` correction naming the published PMID, and that PMID is the exemplar. A preprint with no published version yet cannot be an exemplar, because helix has no `doi:` namespace (contract §0). The exemplar also passes the retraction gate before any lane starts, like any other `pmid:` claim; a `correction` on the paper is not a retraction.

## Fleet

One campaign is one `bell` Mission. The mapping is fixed, so a campaign is readable as `bell` objects and nothing new has to be invented:

| Campaign part | `bell.wetware/v1` | Held where |
|---|---|---|
| the campaign | `Mission` (namespace), `spec.metric` = `pace`, `direction: max` | `bell` |
| a distilled problem | `Need`, `spec.source: operational`, `spec.user` = whose experience it is about | `bell` |
| a lane | `Case` with its budget, plus one `Group` | `bell` |
| a worker | `Member` (`staff`, `assistant`, `instigator`, `genius`, `systems`, `developer`) | `bell` |
| a proposed tool | `Invention` with its check | `bell` |
| the night that tests it | a `popper` loop, one lane per GPU | `popper` |
| the talk between lanes | an `agora` channel per lane, `#general` for the campaign | `agora` |
| the residue | claims on helix pages | this repository |

A campaign reaches helix only through its **scribe**: one Ed25519 editor key per campaign, listed in the manifest. The scribe is never in `genome.json` `roles`, so a campaign can never verify or seal its own edit (`self_verify`, contract §7). A fleet with many members still has one scribe key, because a receipt names one editor.

## Stages

```text { type: notebook.cell }
crawl ─► distil ─► post ─► research ─► invent ─► gate ─► transcribe ─► pace
```

| # | Stage | Does | Refuses with |
|---|---|---|---|
| 1 | `crawl` | read new preprints and records on the frontier; deduplicate by DOI, then by resolved PMID | `duplicate_doi` |
| 2 | `distil` | reduce each paper to one `Need` statement within the manifest's `maxChars` | `undistilled` |
| 3 | `post` | open the problem on the campaign's `agora` root so other lanes can see it | — |
| 4 | `research` | run a `popper` night per lane: a conjecture, a prediction, a refutation attempt | — |
| 5 | `invent` | map a surviving problem to a tool: a `bell` `Invention` with a check, in the `web` reasoning style | `instigator_builds` |
| 6 | `gate` | the proof gate of [commit-artefact.md](commit-artefact.md) | `ungated` |
| 7 | `transcribe` | build one RNA per artefact and settle it here (`skills/transcribe-page.md`) | any code in contract §5 |
| 8 | `pace` | count what was sealed this turn and report it as the Mission metric | `unpaced` |

Stages 1–6 happen outside this repository. Only stage 7 touches `genome.json`, and it touches it exactly as any editor does.

## Manifest

A campaign is declared in one JSON file, the only artefact of this sub-specification that a deployment needs:

```text { type: notebook.cell }
Campaign = { campaign: 1, id: ^[a-z0-9][a-z0-9-]{2,30}$, steward: String,
             frontier: Frontier, scribe: Ed25519Key, endpoint: URL,
             lanes: [Lane], maxChars: 200..2000, gate: Gate, pins: Pins }
Lane     = { name: ^[a-z0-9][a-z0-9-]{2,30}$, case: Name, disciplines: [String], turns: Int, sandboxSeconds: Int }
Gate     = { deltaMin: Number, replicates: 2.., read: ReadStatus, refutations: "counted" }
Pins     = { "<owner>/<repo>": ^[0-9a-f]{40}$ }      # every repository the campaign reads, by commit
```

- `pins` is the campaign's own reproducibility record: a commit for `bell`, `popper`, `agora`, `web`, `tesseract` and `bases`, read once per campaign and never floated to a branch (`stale_pin`).
- `endpoint` is the helix endpoint the scribe posts to. One campaign, one endpoint.
- `gate.read` is the lowest read status an artefact's template claims may carry, and it is never below `fulltext-claim-checked`, because anything lower does not render as a statement (contract §6).
- A manifest is data, not evidence: nothing in it is ever copied into a claim.

Two worked manifests, each two lanes:

| File | Frontier | Exemplar |
|---|---|---|
| [`examples/programmable-receptors.json`](examples/programmable-receptors.json) | `sensory` at the `membrane` | `pmid:39633047`, synthetic GPCRs (Nature 2025), reached from the preprint `10.1101/2024.04.15.589622` |
| [`examples/typable-transporters.json`](examples/typable-transporters.json) | `communication` through the `golgi` | `pmid:37437570`, engineered RNA export (Cell 2023) |

## Run state

A run keeps its working files outside this repository, under `~/campaigns/<id>/`:

```text { type: notebook.cell }
~/campaigns/<id>/campaign.json      the manifest as deployed
~/campaigns/<id>/lanes/<name>/      popper traces, bell turn reports
~/campaigns/<id>/rna/<key>.json     signed edits, before and after settle
~/campaigns/<id>/receipts/          settle receipts, by idempotency key
```

Nothing under `~/campaigns` is committed here. A specbase holds rules; a run holds results. The only durable output of a campaign in this repository is sealed claims and their receipts in `genome.json`.

## Pace

Pacing the frontier is a number, so a campaign can be judged:

```text { type: notebook.cell }
paced(turn)  = { c in sealed(turn) | c.strand = "template" and c.read >= gate.read }
pace(turn)   = |paced(turn)| + |{ c in paced(turn) | c.predicate in { supports, refutes } }|
```

A refutation counts twice, because removing a wrong claim from the record of what is believed advances the frontier as much as adding a right one, and nothing is ever deleted (contract §4). `pace` is the `bell` Mission metric with `direction: max`, and `deltaMin` comes from `gate.deltaMin`. A turn that seals nothing is not an error; a campaign whose `pace` is zero over its Case horizon has its lane closed by `bell`'s `fund` controller, not by helix.

## Refusals

Campaign codes are distinct from the helix codes in contract §5, and agents match the code, never the message. A campaign refusal stops a stage; it never writes anything here.

| Code | When |
|---|---|
| `off_frontier` | the exemplar does not resolve, or an artefact's subject is outside the declared function and compartment |
| `duplicate_doi` | a paper already crawled, by DOI or by resolved PMID |
| `undistilled` | a problem statement is empty or over `maxChars` |
| `ungated` | an artefact reached `transcribe` without a passing gate |
| `prose_leak` | a memo, conjecture, board cast or trace line was put into a claim object |
| `stale_pin` | a repository in `pins` was read at anything other than its pinned commit |
| `unpaced` | a turn reported a `pace` it cannot recompute from its receipts |

## Falsification

The campaign layer is wrong if any of these is seen:

- C1 A campaign key appears in `genome.json` `roles`.
- C2 A claim settled by a scribe holds text from a memo, a trace or a board cast.
- C3 An artefact was transcribed whose gate verdict was refuted or inconclusive.
- C4 Two campaigns declare the same frontier and the same lane names against one endpoint.
- C5 A manifest pins a branch instead of a commit, or omits a repository it read.
- C6 `pace` for a turn cannot be recomputed from the receipts of that turn.
- C7 A campaign's own output is cited as the evidence for its next claim.

## Citations

- `wetware-hq/bell` at `2543b9dee1e387f459cae849307fc4aae910a38a`. Claim: Mission, Need, Case, Group, Member, Invention, the turn order and the systems gate. Boundary: helix runs no controller.
- `wetware-hq/popper` at `32c0a9ff49b71031a9dd1a991e349d18b5689b1c`. Claim: the night, the prediction stated before the run, the Prover and the per-lane swarm. Boundary: a verdict is corroboration, never truth.
- `wetware-hq/agora` at `f3c87977b5065fe1c7b909ee0537e10b655dd7cc`. Claim: lane channels and the board. Boundary: a cast is never evidence here.
- `wetware-hq/web` at `5588dfa59e4bf74319080bb551162bfd4649c810`. Claim: the reasoning style and the DNA primitive (`docs/organize-stack.md`).
- `wetware-hq/tesseract` at `94616c82cdc5889429f16ffa3677dd6a02e65b04`. Claim: a `tess1` plan root for a proposed build.
- `wetware-hq/bases` at `1ee66647faac5e04000c4676e77c9dd2bd21a8b1`. Claim: the chromosome token a `dna:` page reads.
- Bashor CJ, Horwitz AA, Peisajovich SG, Lim WA. Rewiring cells: synthetic biology as a tool to interrogate the organizational principles of living systems. Annu Rev Biophys 2010;39:515–537. `pmid:20192780`. Claim: a biological function is addressed as a rewirable module, which is why a frontier is a function in a compartment. Boundary: cited as framing, not as evidence for any claim.

## Licence

MIT, see `LICENSE`. bell, popper, agora, web, tesseract and bases are pinned by commit, not vendored.
