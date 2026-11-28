# `transcribe-page` — build an edit

`type: resource.procedure` · `spec: agent.skill` · subordinate to `docs/follow-agent-contract.md`, which governs on any conflict.

Read a page's current terms, then build and sign one RNA edit that only appends claims. This is the editor's skill. It writes nothing to the genome.

## Specification

```json { type: notebook.cell }
{
  "id": "skills/transcribe-page.md",
  "type": "resource.procedure",
  "role": "turn a 402 offer into a signed append-only edit",
  "reads": ["PAYMENT-REQUIRED header", "authority records"],
  "writes": [],
  "must": ["echo info unchanged", "append only", "no duplicates", "one key per edit"],
  "check": ["H2", "H3", "H4", "H8"]
}
```

## Graph

- ← [resolve-locus.md](resolve-locus.md)
- ← [../campaigns/pace-frontier.md](../campaigns/pace-frontier.md)
- → [verify-claim.md](verify-claim.md)

## Indications

- Add a claim, a typed edge, a citation, a refutation or a scratch hypothesis to a page.
- Create a page that does not exist yet.

## Contraindications

- Do not copy text from a rendered page into a claim (`reverse_flow`).
- Do not edit or remove a claim; append a `refutes` claim instead.
- Do not set `read` above the source ceiling.

## Algorithm

```text { type: notebook.cell }
1. POST /wiki/{id} with no PAYMENT-SIGNATURE          -> 402
2. offer  := base64json(PAYMENT-REQUIRED)
   info   := offer.extensions["helix-page"].info      # { id, parent, count, nonce, expires }
3. append := one or more new claims, each with subject = info.id, none already on the page;
             a new page (count = 0) starts with a template label
4. rna    := { id: info.id, editor: pubkey, parent: info.parent, append,
               key: uuid4, nonce: info.nonce, expires: info.expires }
5. payload := { x402Version: 2,
                resource: offer.resource,
                accepted: offer.accepts[0],              # same JSON value as offered
                payload: { rna, sig: ed25519(sk, sha256(JCS(rna))) },
                extensions: { "helix-page": { info: info + { key: rna.key } },
                              "payment-identifier": { info: { required: true, id: rna.key } } } }
6. POST /wiki/{id} with PAYMENT-SIGNATURE = base64json(payload)
```

- `accepted` and `info` are compared as JSON values after decoding, not as bytes.
- Each extension's `info` keeps every offered field and adds only `key` or `id`: the x402 add-only echo rule.
- `sig` is unpadded base64url of `ed25519(sk, sha256(JCS(rna)))` over the 32 raw digest bytes.
- The signature covers `id`, `editor`, `parent`, `nonce` and `expires`, so the edit cannot be moved to another page, version, offer or author.
- Each nonce works once. A retry of the same RNA after success is answered from the receipt; any new attempt needs a new offer.
- A scratch claim may have `pin: null` and `read: "unread"`. A template claim may not.
- On `stale_parent` or `expired`: drop claims that are now present, and start again at step 1 with a new `key`.
- On `duplicate`: drop the named claims and start again at step 1.

## Falsification

- A payload built by this skill fails `/verify` with `bad_envelope`, `overwrite` or `duplicate` on a page that did not change.

## Licence

MIT, see `LICENSE`.
