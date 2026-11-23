# `verify-claim` — proofread an edit

`type: resource.procedure` · `spec: agent.skill` · subordinate to `docs/follow-agent-contract.md`, which governs on any conflict.

Check one signed RNA edit against the genome and its sources. Return a signed `VerifyResponse` with `isValid` or the first refusal code. Read-only, like x402 `/verify`.

## Specification

```json { type: notebook.cell }
{
  "id": "skills/verify-claim.md",
  "type": "resource.procedure",
  "role": "accept or refuse one edit with a code",
  "reads": ["PaymentPayload", "issued offer for rna.nonce", "genome.json", "authority records"],
  "writes": [],
  "must": ["write nothing", "stop at the first failing check", "verifier is not the editor", "sign the result"],
  "check": ["H1", "H2", "H3", "H4", "H6", "H7", "H8", "H9"]
}
```

## Graph

- ← [transcribe-page.md](transcribe-page.md)
- ← [../docs/pin-references.md](../docs/pin-references.md)
- → [../systems/seal-page.md](../systems/seal-page.md)

## Indications

- Every `POST` with a `PAYMENT-SIGNATURE`, before anything is written.

## Contraindications

- Do not fix an edit; refuse it.
- Do not settle. Settling is `systems/seal-page.md`.

## Algorithm

The request body is `{ paymentPayload, paymentRequirements, offer, route }`: x402's two fields, the full signed `PaymentRequired` offer, and the page ID from the URL. The verifier needs no shared state to check the echo: the offer signature proves what was offered. Whether a nonce was already used is checked by the sealer. Checks run in this order; the first failure is the answer. Local checks come before any network call.

```csv { type: notebook.cell }
order,check,code
0,"request carries a valid Helix-Signature from a roles.endpoint key",no_role
0a,"body at most 256 KB; append at most 32 claims; at most 4 attestations per claim",too_large
1,"x402 v2 envelope parses (SDK schemas); payload is exactly { rna, sig } and rna has exactly the §1 RNA fields with valid types; resource equals the signed offer's; accepted equals an entry of the signed offer and equals paymentRequirements; editor signature valid over sha256(JCS(rna))",bad_envelope
2,rna.id equals the route; every ID and claim subject valid and equal to rna.id,bad_id
3,"offerSig valid from the roles.endpoint key named in the offer's helix-page info.endpoint; info.id equals rna.id; rna.expires not passed",expired
4,"each extension info echoes every offered field and adds only key (helix-page) or id (payment-identifier); rna.parent, nonce, expires and key equal helix-page info; payment-identifier id equals rna.key",overwrite
5,verifier key differs from rna.editor,self_verify
6,verifier key is in roles.verifier,no_role
7,append is not empty,empty
8,no claim field outside §1,reverse_flow
8a,"every claim has all §1 fields; strand and read are enum values; a template claim is not unread; a scratch claim has pin null and read unread; pin is null or has exactly the Pin fields in their grammars; attest is absent or non-empty and well formed",bad_claim
9,predicate and object kind and literal fit the §3 table; a supports or refutes target is already in the locus or earlier in the same append,bad_predicate
10,rna.parent equals the current root (root(empty) for a new page),stale_parent
11,new page: append has a template label,no_label
12,no repeated cid in append and none already in the locus,duplicate
13,every template claim has a pin,unpinned
14,"pinned claims: pin.source, url and field equal the pin-table entry for the subject namespace and predicate; the edit needs at most 64 fetches",bad_source / too_large
15,new page: the ID exists at its authority,unknown_locus
16,pinned claims: digest(pin) equals pin.digest,hash_drift
17,"pinned claims. Record rows: binds(claim) holds. Paper rows: the pinned PMID is right (equals the object for cites) and the binding attestation in docs/pin-references.md is valid",evidence_mismatch
18,"read within the source ceiling, or second-read / human-oracle; attestations valid and meet the table in docs/pin-references.md",read_ceiling
19,every pmid pinned or cited by a template claim passes the three-source gate,retracted
```

- Steps 0 and 0a need no parsing beyond the signature header and sizes, so oversized or unsigned requests are refused before any hashing or network call.
- If steps 0 to 1 fail before `rna` or the offer can be parsed, the answer is an HTTP `400` error body, not a `VerifyResponse`.
- `systems/seal-page.md` repeats steps 3, 10 and 12 under its lock, and decides `replay`, because the genome can change between verify and settle.
- An authority that does not answer at step 15, 16, 17 or 19 gives `unavailable`: never a pass and never a refusal of the claim.
- `unsafe` has no step: no current claim can hold free text (contract §1).

```text { type: notebook.cell }
VerifyResponse = { isValid: true,  payer: rna.editor, rna: hex(sha256(JCS(rna))), offer: hex(sha256(JCS(offer))), verifier: key, sig }
               | { isValid: false, invalidReason: Code, payer: rna.editor, rna: ..., offer: ..., verifier: key, sig }
```

`sig` is the verifier's signature over `sha256(JCS(response without sig))`. The sealer checks it.

`/verify` always returns a `VerifyResponse`. Idempotent retries are answered from receipts by `POST /wiki/{id}` and `/settle`, never by `/verify`.

## Falsification

- A valid edit is refused, or an edit with a duplicate or mismatched claim is accepted.
- `/verify` changes `genome.json`.

## Licence

MIT, see `LICENSE`.
