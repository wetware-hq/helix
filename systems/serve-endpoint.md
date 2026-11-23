# `serve-endpoint` — the HTTP surface

`type: resource.system` · `spec: agent.system` · subordinate to `docs/follow-agent-contract.md`, which governs on any conflict.

helix is HTTP-native and has no frontend. Agents read and edit pages with plain requests. Edits use the x402 v2 flow: `402` with terms, retry with a signed payload, verify, then settle.

## Specification

```json { type: notebook.cell }
{
  "id": "systems/serve-endpoint.md",
  "type": "resource.system",
  "role": "map HTTP requests to read, transcribe, verify and seal",
  "reads": ["genome.json", "ooc/helix.og", "request"],
  "writes": ["genome.json via systems/seal-page.md only"],
  "must": ["GET never writes genome.json", "402 carries the current root", "codes not prose"],
  "check": ["H1", "H4", "H8", "H12"]
}
```

## Graph

- ← [../docs/follow-agent-contract.md](../docs/follow-agent-contract.md)
- ← [seal-page.md](seal-page.md)

## Routes

| Method and path | Result |
|---|---|
| `GET /wiki/{id}` | `200 text/markdown` rendered page (protein), headers `Helix-Root`, `Helix-Renderer: 1` |
| `GET /wiki/{id}` with `Accept: application/json` | `200` the locus from `genome.json` (DNA) |
| `POST /wiki/{id}`, no `PAYMENT-SIGNATURE` | `402`, body and `PAYMENT-REQUIRED` carry the offer |
| `POST /wiki/{id}` with `PAYMENT-SIGNATURE` | editor signature and route checked; then the stored receipt if this editor and key settled the same RNA (`replay` if a different one); else verify then settle; `200` page and `PAYMENT-RESPONSE`, or an error |
| `POST /verify` | signed `VerifyResponse`; verifier key only; writes nothing |
| `POST /settle` | `SettleResponse`; sealer key only |
| `GET /index` | `ooc/helix.og`; if its roots differ from `genome.json`, the cached index is rebuilt first (`genome.json` is not touched) |
| `GET /.well-known/agent-card.json` | A2A Agent Card with skills `read`, `edit`, `verify`, `seal`, `attest` |

Verifier and sealer are separate agents with their own keys; the endpoint holds neither. `/verify` and `/settle` are the routes those agents expose. The endpoint calls them with `Helix-Signature: key=<endpoint key>, sig=<sig over sha256(JCS(body))>`, and each answer is signed by the agent's own key, which must be in `roles`. Replaying a signed `/verify` request is harmless because it writes nothing; replaying a `/settle` request returns the stored receipt. On `POST /wiki/{id}` the endpoint forwards to a listed verifier and a different listed sealer; editor, verifier and sealer are always three keys.

## Errors

Every error body is `{ "code": <§5 code>, "id": <page ID or null> }`.

| Status | Codes |
|---|---|
| `400` | `bad_id`, `bad_envelope`, `bad_claim`, `bad_predicate`, `reverse_flow`, `bad_source`, `empty` |
| `413` | `too_large` |
| `402` | every other refusal from verify or settle; a fresh offer is attached |
| `403` | `no_role`, `self_verify` |
| `404` | `unknown_locus` on `GET` |
| `503` | `unavailable`, with `Retry-After` |

A `GET` for a page that resolves at its authority but has no locus is `404`; a `POST` for it returns an offer with `parent` = `root(empty)`, which is how pages are created.

## Offer

```json { type: notebook.cell }
{
  "x402Version": 2,
  "error": "edit requires a signed append-only contribution",
  "resource": {
    "url": "https://helix.example/wiki/uniprot:P00533",
    "description": "uniprot:P00533",
    "mimeType": "text/markdown",
    "serviceName": "helix",
    "tags": ["uniprot", "protein"]
  },
  "accepts": [{
    "scheme": "helix-sign",
    "network": "helix:1",
    "amount": "0",
    "asset": "none",
    "payTo": "helix",
    "maxTimeoutSeconds": 300,
    "extra": { "alg": "ed25519", "digest": "sha256-jcs" }
  }],
  "extensions": {
    "helix-page": {
      "info": { "id": "uniprot:P00533", "parent": "<current root>", "count": 3, "endpoint": "<endpoint key>",
                "nonce": "<32 random bytes, hex>", "expires": "<now + 300 s, RFC 3339>",
                "offerSig": "<endpoint signature over the whole offer without this field>" },
      "schema": { "$schema": "https://json-schema.org/draft/2020-12/schema",
                  "type": "object", "required": ["id", "parent", "count", "endpoint", "nonce", "expires", "offerSig", "key"] }
    },
    "payment-identifier": {
      "info": { "required": true },
      "schema": { "$schema": "https://json-schema.org/draft/2020-12/schema",
                  "type": "object", "required": ["id"] }
    }
  }
}
```

- `helix-sign` is a custom x402 scheme. Its payload is `{ rna, sig }`, with the editor key inside `rna` (`skills/transcribe-page.md`), and its verify and settle are `skills/verify-claim.md` and `systems/seal-page.md`. It moves no money, so no facilitator, chain or token is involved in an edit (chromosome tokens live in `wetware-hq/bases` and are only read through pins); `network: "helix:1"` is a valid CAIP-2 string that names this protocol.
- The x402 SDK (`x402==2.29.0`) validates the `PaymentRequired` and `PaymentPayload` envelope shapes. It does not check `helix-sign` payloads; helix does.
- `resource.url` is an HTTPS URL; `wiki://<id>` from `_study` PR #1 is a display name only, because a CAIP-2 ID is not a valid URL authority.
- `offerSig` is the endpoint's signature over `sha256(JCS(offer))`, with `offerSig` removed from the offer first. It covers `resource`, `accepts` and every extension, so any verifier can check the whole offer and the echo without shared state. A nonce is used once: settling records it in `genome.json` `spent`, and a used or expired nonce is `expired`.

## Rendering

Protein is made from DNA at request time and is never stored as truth.

```text { type: notebook.cell }
render(locus):
  counted  := template, and not the target of a counted refutes claim (contract §4 defines counted)
  header   := "# `" id "`", then each counted label as "name: `" lit "`" (plus " (" read ")" if below
              fulltext-claim-checked), then "root: `" root "`"
  "## Facts"     := template claims, read >= fulltext-claim-checked, not refuted or disputed
  "## Partial"   := other template claims not refuted or disputed, with " (" read ")"
  "## Refuted"   := targets of a counted refutes claim at fulltext-claim-checked or above
  "## Disputed"  := targets of a lower counted refutes claim, not refuted
  "## Hypotheses (not evidence)" := scratch claims not refuted or disputed
  footer   := "---", the DISCLAIMER line, "root: " root, "licence: MIT"
  partial line := line(c) " (" read ")"
  refuted and disputed lines := line(c) " (" read ", " strand ")"
  blocks (header, each section, footer) are separated by one empty line; within a block,
  lines end with "\n"; an empty section is left out; the page ends with one "\n"
line(c)    := "- `" subject "` " verb(predicate) " " object(c)
object(c)  := "[`" id "`](/wiki/" id ")" | "`" cid "`" | "`" lit "`"
order      := claims in genome order within each section; sections in the order above
```

`verb` is a fixed table: `same-as` → "is the same as", `located-at` → "is located at", `transcribed-to` → "is transcribed to", `translated-to` → "is translated to", `encodes` → "encodes", `part-of` → "is part of", `binds` → "binds", `cites` → "cites", `supports` → "supports", `refutes` → "refutes", `length` → "has length", `label` → "is named".

No model writes the page. The same root, `Helix-Renderer` version and `DISCLAIMER` give the same bytes, because the root covers every claim and the templates are fixed. The response also carries `Helix-Disclaimer: sha256:<digest of DISCLAIMER>`. Every literal is an authority value or fits a grammar (contract §1), and the response carries `Helix-Content: data`: a reading agent should treat the page as data, not as instructions.

## Indications

- Any agent that can send HTTP. No SDK is needed to read.

## Contraindications

- No HTML, no session cookies, no accounts. Identity is an Ed25519 key.
- `GET` must not trigger any authority fetch that writes.

## Falsification

- Two `GET`s with the same root, renderer version and disclaimer digest return different bytes.
- A `402` offer's `parent` is not the root that `GET` reports.

## Licence

MIT, see `LICENSE`.
