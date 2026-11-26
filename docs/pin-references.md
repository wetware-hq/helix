# `pin-references` — evidence and read ceilings

`type: resource.policy` · `spec: agent.policy` · subordinate to `docs/follow-agent-contract.md`, which governs on any conflict.

A pin says where a claim can be re-read, what value was read there, and how far it was read. This file sets the pin shape, which sources may be pinned, the highest read status each allows, and the retraction gate.

## Specification

```json { type: notebook.cell }
{
  "id": "docs/pin-references.md",
  "type": "resource.policy",
  "role": "define pins, source ceilings, attestations and the retraction gate",
  "reads": ["claim", "authority record"],
  "writes": [],
  "must": ["pin fixed by the pin table", "chain rows: eth_call at the pinned block", "record rows: value equals the claim object", "paper rows: bind by attestation", "three-source retraction gate"],
  "check": ["H3", "H6", "H7"]
}
```

## Graph

- ← [follow-agent-contract.md](follow-agent-contract.md)
- → [../skills/verify-claim.md](../skills/verify-claim.md)

## Pin

```text { type: notebook.cell }
Pin = { source: Namespace, release: String, url: URL, field: JsonPointer, digest: "sha256:" Hex }

value(pin)   = JSON value at pin.field in the body of GET pin.url, Accept: application/json
digest(pin)  = "sha256:" + lowercase_hex(sha256(JCS(value(pin))))
binds(c)     = str(value)            == c.object.lit                       # lit objects
             | strip_version(value)  == reference(c.object.id)             # id objects
strip_version("ENST00000275493.7") = "ENST00000275493"
```

- A pin is not chosen freely. `source`, `url` and `field` are fixed by the claim's subject namespace and predicate, from the table below. `{ref}` is the subject reference, or the paper's PMID for paper rows, and must match its §0 reference pattern before it is substituted. Any other combination is `bad_source`.
- `release` matches `^[A-Za-z0-9 ._:-]{1,48}$`. Pins are never rendered.
- Fetches use HTTPS, follow no redirects, send no credentials, and stop at 1 MB and 10 s.
- `200` with a JSON body gives the value. `400`, `404` or `410`, an empty result list, or a missing pointer means absent: `unknown_locus` for the `label` pin of a page being created, `evidence_mismatch` for any other claim. Every other outcome (any `3xx`, other `4xx`, `429`, `5xx`, DNS, TLS or connect failure, timeout, oversized or non-JSON body) is `unavailable`.
- `release` is the editor's note of the snapshot read, such as `UniProtKB 2026_04 entryVersion 302` or `Ensembl 116 GRCh38`. It is a hint, not evidence: the verifier checks only its grammar, and `digest` is what is checked. Where the authority serves only its current record (HGNC, the Ensembl REST service), a later change shows up as `hash_drift`.
- There is no retrieval date in the pin. The settle time is in the receipt, which the sealer signs.
- A claim whose object the pinned value does not state is refused with `evidence_mismatch`, even if the digest is right.

## Pin table

`source` is the subject namespace, except on the last row, where it is `pmid`.

| Subject | Predicate | `url` | `field` |
|---|---|---|---|
| `hgnc` | `label`, `located-at`, `same-as` | `https://rest.genenames.org/fetch/hgnc_id/{ref}` | `/response/docs/0/name`, `/response/docs/0/location`, `/response/docs/0/ensembl_gene_id` |
| `ensembl` | `label`, `transcribed-to` | `https://rest.ensembl.org/lookup/id/{ref}?content-type=application/json` | `/display_name`, `/canonical_transcript` |
| `ensembl` | `translated-to` | `https://rest.ensembl.org/xrefs/id/{ref}?external_db=Uniprot/SWISSPROT;all_levels=1;content-type=application/json` | `/0/primary_id` |
| `uniprot` | `label`, `length` | `https://rest.uniprot.org/uniprotkb/{ref}.json` | `/proteinDescription/recommendedName/fullName/value`, `/sequence/length` |
| `pdb` | `label` | `https://data.rcsb.org/rest/v1/core/entry/{ref}` | `/struct/title` |
| `chebi` | `label` | `https://www.ebi.ac.uk/chebi/backend/api/public/compound/{ref}/` | `/name` |
| `pmid` | `label` | `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:{ref}%20AND%20SRC:MED&format=json&resultType=core` | `/resultList/result/0/title` |
| `dna` | `label`, `length`, `sequence-root`, `prints`, `held-by`, `printed` | `genome.json` `chain.rpc` (chain row) | `/tokenURI`, `/lengthOf`, `/rootOf`, `/printsOf`, `/ownerOf`, `/Polymerized` |
| any | `cites`, `supports`, `refutes`, `binds`, `encodes`, `part-of` | the `pmid` `url` above, with the paper's PMID | `/resultList/result/0/pmid` |

The table is the allowlist. A verifier fetches nothing else, so a pin cannot point at a private address, a path on a shared host, or a site the editor controls.

## Chain rows

A `dna:` pin reads the `Bases` contract in `genome.json` `chain` with one JSON-RPC `eth_call`, not a `GET`; a `printed` pin reads one block's logs with `eth_getLogs`.

```text { type: notebook.cell }
release     = "block " n                               # n decimal, no leading zero
value(pin)  = abi_decode(POST pin.url { "jsonrpc": "2.0", "id": 1, "method": "eth_call",
                params: [{ to: chain.contract, data: selector(pin.field) || uint256(ref) }, hex(n)] })
selector    = first 4 bytes of keccak256 of tokenURI(uint256) | lengthOf(uint256) | rootOf(uint256) | printsOf(uint256) | ownerOf(uint256)
binds(c)    = str(value)                      == c.object.lit     # label (tokenURI); length, prints as decimal, no leading zero
            | lowercase_hex(value)            == c.object.lit     # sequence-root, no 0x
            | chain.network ":" lower(value)  == c.object.lit     # held-by, CAIP-10
logs(pin)   = POST pin.url { "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
                params: [{ address: chain.contract, fromBlock: hex(n), toBlock: hex(n),
                           topics: [keccak256("Polymerized(uint256,address,bytes32,uint64,bytes32)"), uint256(ref)] }] }
binds(c)    = some log in logs(pin) with abi_decode(data) = (receipt, prints, head)
              and str(prints) ":" lowercase_hex(receipt) == c.object.lit     # printed
value(pin)  = { "prints": str(prints), "receipt": lowercase_hex(receipt), "head": lowercase_hex(head) }
                                                  # printed: the matching log, so digest(pin) is defined
```

- `{ref}` is the 32-hex `dna:` reference read as a `uint256`. `pin.url` must equal `chain.rpc`, which is HTTPS; the fetch rules above apply.
- On chain rows `release` is evidence, not a hint: the call is made at block `n`, so the value is reproducible and a later transfer or print never causes `hash_drift`. A newer `held-by` or `prints` is a new claim pinned at a newer block; `sequence-root` and `length` never change after mint.
- A chain-row pin's block `n` must be finalized: at or below `eth_getBlockByNumber("finalized", false).number` read from `chain.rpc` once per edit. A later block is `unavailable`, so a reorganization cannot remove a value after it is sealed.
- A `printed` pin is evidence of one print: a log at block `n` cannot change, so it is never superseded and never causes `hash_drift`. No log matching the claim is `evidence_mismatch`.
- An execution revert (for example `ERC721NonexistentToken`) means absent. Any other JSON-RPC error is `unavailable`.
- A `dna:` page is created with its `label` pin (`tokenURI`), which also proves the token exists.

## Papers

Papers have no JSON field that states a finding, so `binds` cannot be computed for paper rows.

- For `cites`, the pinned PMID must equal the object, and a reader attests that the subject is discussed in the paper.
- For `supports`, `refutes`, `binds`, `encodes` and `part-of`, the pinned PMID names the paper, and a reader attests that the paper says it.
- In both cases the attestation is the bind (table below). A paper claim with no valid attestation is `evidence_mismatch`.

## Source ceilings

| Source | Pinnable | Ceiling |
|---|---|---|
| UniProtKB, HGNC, Ensembl, wwPDB, ChEBI JSON record | yes | `fulltext-claim-checked` |
| `Bases` contract state at a pinned block (chain row) | yes | `fulltext-claim-checked` (the chain is the record) |
| Open-access paper (Europe PMC `isOpenAccess` = `Y`) | yes | `fulltext-claim-checked` |
| Paywalled paper | yes | `abstract-read` |
| Paper `label` (title from Europe PMC) | yes | `fulltext-claim-checked` (the title is the record) |
| Crossref, OpenAlex, Citoid | no | retraction gate and discovery only |
| No pin (scratch only) | — | `unread` |
| Wikipedia, Wikidata | no | discovery only: may suggest an ID or a PMID, never a pin |
| Rendered helix page | no | refused as `reverse_flow` |

## Attestations

```text { type: notebook.cell }
Attestation = { reader: Ed25519Key, read: ReadStatus,
                sig: ed25519(sha256(JCS({ core: sha256(JCS(core(c))), read }))) }
attestations needed for each claim read: see the table
```

| Claim `read` | Attestations needed (no key may be the editor's) |
|---|---|
| up to `fulltext-claim-checked`, record row | none |
| up to `fulltext-claim-checked`, paper row | one from `roles.reader`, with `read` equal to the claim's |
| `second-read` | two from different `roles.reader` keys, each with `read` = `second-read` |
| `human-oracle` | one from `roles.oracle` with `read` = `human-oracle`; on a paper row this is also the bind |

An attestation signs one claim at one `read`. Raising `read` means a new claim, so its readers sign again; that is deliberate.

Attestations sign `core(c)`, which leaves out `attest`, so a signature never has to cover itself. Only listed keys count, so making new keys does not make new readers. A claim with no attestations omits `attest`; it is never `[]`. A paywalled paper stays at `abstract-read` unless two readers who opened it attest. `human-oracle` can be given only by a listed licensed human.

## Retraction gate

```text { type: notebook.cell }
gate(pmid) =
  e := Europe PMC search EXT_ID:<pmid> AND SRC:MED (resultType=core, format=json)
  flags :=
    "Retracted Publication" in e.pubTypeList.pubType
    GET https://api.openalex.org/works/pmid:<pmid>           .is_retracted == true
    GET https://api.crossref.org/works/<urlencode(e.doi)>    any .message.updated-by[].type == "retraction"
  e.doi must match ^10\.[0-9]{4,9}/[-._;()/:A-Za-z0-9]+$, or Crossref counts as unavailable
  a 404 from OpenAlex or Crossref means that source has no record and raises no flag
  any flag                     -> retracted
  any source unavailable       -> unavailable   # not a pass
  e has no doi                 -> Crossref is skipped; the other two decide
  otherwise                    -> clear
```

Checked on 23 Nov 2026 with `pmid:9500320`: all three flag it. Crossref returned `updated-by` entries of type `retraction` and `correction`, both with `source` = `retraction-watch`.

All three are needed. Citoid is not one of them: it missed the retraction of `pmid:9500320` that the other three caught, and it adds a random `key` on each call.

## Indications

- Before any template claim is settled.
- When re-checking a page after an authority release.

## Contraindications

- Do not treat a citation count, a Wikipedia mention or a model answer as a read.
- Do not raise `read` on an existing claim; append a new claim with the higher status and its attestations.

## Falsification

- A paper later shown retracted passed the gate while all three sources answered.
- Two fetches of the same release give a different `digest`.

## Licence

MIT, see `LICENSE`.
