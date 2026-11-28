# `commit-artefact` — the gate, and what an artefact becomes here

`type: resource.policy` · `spec: agent.policy` · subordinate to `docs/follow-agent-contract.md`, which governs on any conflict.

A campaign's lanes produce artefacts: a proposed tool for a problem on the frontier, with a check that was run. This file says when such an artefact may be transcribed into helix, and which claims it becomes. It adds no predicate and no refusal code to the contract: an artefact is said in the vocabulary helix already has, or it is not said here at all.

## Specification

```json { type: notebook.cell }
{
  "id": "campaigns/commit-artefact.md",
  "type": "resource.policy",
  "role": "gate a released artefact and map it onto existing claims",
  "reads": ["bell Invention", "popper verdict", "campaigns/<id>.json gate"],
  "writes": [],
  "must": ["gate before transcribe", "existing predicates only", "a refutation is a claim, never a deletion", "the campaign is never its own evidence"],
  "check": ["C2", "C3", "C7", "H2", "H3", "H6", "H7"]
}
```

## Graph

- ← [pace-frontier.md](pace-frontier.md)
- → [../docs/pin-references.md](../docs/pin-references.md)
- → [../skills/verify-claim.md](../skills/verify-claim.md)

## The gate

An artefact reaches `transcribe` only if all four hold, in this order. The first failure stops it, and the artefact stays in `bell` with its phase.

| # | Gate | Source | On failure |
|---|---|---|---|
| 1 | **Needed.** The artefact cites an open `Need` of the campaign, on the declared frontier. | `bell` systems gate | `unneeded`, `off_frontier` |
| 2 | **Predicted.** A prediction was stated before the run, and the decision rule was proved. | `popper` Conjecturer, Prover | `ungated` |
| 3 | **Corroborated.** Every candidate replicate beat every baseline replicate by `gate.deltaMin`, or it cost strictly less without being worse on average. | `popper` Critic, `bell` `develop` | the artefact is `Refuted` or `Inconclusive` |
| 4 | **Pinnable.** Every claim the artefact would make has a pin from the pin table, and a value that binds. | `docs/pin-references.md` | `unpinned`, `bad_source`, `evidence_mismatch` |

A crash is inconclusive, never a pass. Gates 1–3 happen in the fleet; gate 4 is checked by building the RNA and reading it back, before anything is posted.

## What an artefact becomes

A released artefact is not one claim. It is split by strand, because a campaign's own output is a hypothesis until an authority or a print says otherwise.

| Artefact part | Claim | Strand | Pin |
|---|---|---|---|
| the exemplar paper | `cites` → `pmid:` | template | paper row, reader attestation, retraction gate |
| a finding the paper states about the subject | `supports` → `cid` of the claim it backs | template | paper row, reader attestation |
| a claim the night refuted | `refutes` → `cid` of the target | template | the paper or record that shows it, never the trace |
| the construct, once it is a token | a `dna:` page: `label`, `sequence-root`, `length`, `held-by`, `prints` | template | chain rows at a finalized block |
| each print of it | `printed` | template | the `Polymerized` log at its block |
| how the lane would build it | `plan` (`tess1` root, machine, parts) | scratch | none |
| the k-mer picture it expects | `glyph` (`cgr1`) | scratch | none |
| the problem, the memo, the conjecture, the trace, the board cast | nothing | — | — |

The last row is the important one. A campaign generates far more text than helix can hold, and none of it is a claim: a `lit` object is either an authority value or a fixed grammar (contract §1), so a distilled problem statement has nowhere to go. Putting one in a claim is `prose_leak` in the fleet and `bad_predicate` or `reverse_flow` at the endpoint.

## Order

```text { type: notebook.cell }
1. resolve the subject                      skills/resolve-locus.md
2. build claims, template first             the table above
3. attach attestations                      docs/pin-references.md §Attestations
4. one RNA per artefact, <= 32 claims       contract §1, too_large
5. POST /wiki/{id} -> 402 -> sign -> settle systems/serve-endpoint.md
6. record the receipt under ~/campaigns     pace-frontier.md §Run state
```

- One artefact is one RNA with one idempotency `key`, so a retried post returns the stored receipt rather than a second copy (`replay`).
- An artefact that spans pages is several RNAs, in subject order, each with its own key. A later one may fail; the earlier ones stay sealed, because nothing is transactional across pages.
- `stale_parent` is normal under a swarm: lanes edit the same page in the same turn. Re-read the page, drop claims that are now `duplicate`, and post again. A lane never serialises another lane by holding a lock.

## Evidence, not self-report

- A `popper` verdict is a reason to make a claim, never the pin for one. A trace is the campaign's own file; a pin must be re-readable at an authority listed in `docs/pin-references.md` (`C7`).
- A plan is a proposal, so it stays scratch until a print reads the sequence back (contract §0). A campaign cannot promote its own plan: a `printed` claim comes from the chain, and the read-back loop decides whether the print agrees with the plan.
- A refuted artefact is still worth transcribing when a source shows the refutation, because a counted `refutes` claim at `fulltext-claim-checked` or above makes its target render as refuted (contract §4), and that is half the pace metric.

## Indications

- A lane's artefact passed `develop` and `release` in `bell`.
- A night refuted a claim already sealed here.

## Contraindications

- Do not transcribe a `Proposed` or `Accepted` artefact. Only the released phase is settled.
- Do not raise the `read` of a sealed claim. Append a new claim with the higher status and its attestations.
- Do not cite a preprint that has no PMID. It is not reachable in helix (`off_frontier`).

## Falsification

- An artefact rendered as a fact while its `popper` verdict was refuted or inconclusive.
- A claim whose pin resolves to a file under `~/campaigns`.
- Two receipts for one artefact and one idempotency key.
- A `plan` claim rendered outside Hypotheses.

## Licence

MIT, see `LICENSE`.
