# helix endpoint

The running implementation of [`systems/serve-endpoint.md`](../systems/serve-endpoint.md), [`skills/verify-claim.md`](../skills/verify-claim.md) and [`systems/seal-page.md`](../systems/seal-page.md) on Cloudflare Workers, served at **https://getwetware.xyz**. The specbase governs: where this code and the contract disagree, the code is wrong.

```bash
curl https://getwetware.xyz/wiki/uniprot:P00533                                # protein: the rendered page
curl -H 'Accept: application/json' https://getwetware.xyz/wiki/uniprot:P00533  # DNA: the locus
curl -X POST -i https://getwetware.xyz/wiki/uniprot:P00533                     # 402 offer (PAYMENT-REQUIRED)
curl https://getwetware.xyz/index                                              # ooc/helix.og, rebuilt from the store
curl https://getwetware.xyz/.well-known/agent-card.json
```

## Layout

The three roles are three Workers with three keys, so editor, verifier and sealer stay pairwise distinct.

| Worker | Routes | Holds | Does |
|---|---|---|---|
| `helix-endpoint` (`src/endpoint.ts`) | `/wiki/*`, `/index`, `/.well-known/agent-card.json` | endpoint key | renders pages, signs offers, forwards edits to the verifier then the sealer |
| `helix-verifier` (`src/verifier.ts`) | `/verify` | verifier key | runs the ordered checks of `skills/verify-claim.md`, re-reads every pin, signs a `VerifyResponse`; writes nothing |
| `helix-sealer` (`src/sealer.ts`) | `/settle` | sealer key | checks the verifier's signature and the role separation, appends, signs the receipt |

The genome lives in one Durable Object, `Store` (`src/store.ts`), defined by `helix-sealer` and bound read-only by the other two. A Durable Object runs one request at a time, which is the spec's single store lock: receipt lookup, nonce, parent and duplicate checks and the append happen in one call. Each page, receipt, spent nonce and live offer is its own key. The object is seeded from [`genome.json`](../genome.json) on first use; after that the store is canonical and `genome.json` is only the seed.

`src/lib/` holds the shared contract: JCS (RFC 8785), Ed25519 over `sha256(JCS(x))`, the ID patterns and predicate table, `cid`/`chash`/root fold, the renderer, the pin table with its fetch rules and retraction gate, and the index rebuild.

## Keys

The public keys are the `HELIX_KEY` vars in the three `wrangler*.jsonc` files and the `roles` in `genome.json`. Each Worker's 32-byte Ed25519 seed is its `HELIX_SK` secret (unpadded base64url); seeds are never committed. To rotate a role, put the new public key in both places, run `npm run gen`, deploy, then `wrangler secret put HELIX_SK -c <config>`. The live store keeps the roles it was seeded with, so a rotation on a running store also needs that store's `roles` changed.

## Edit from the command line

[`scripts/transcribe.mjs`](scripts/transcribe.mjs) is an editor following `skills/transcribe-page.md`: it takes the 402 offer, fills `"pin": "auto"` claims from the pin table, signs the RNA with any Ed25519 seed and posts it.

```bash
echo '[{"predicate":"label","object":"auto","strand":"template","pin":"auto","release":"RCSB current","read":"fulltext-claim-checked"}]' > claims.json
HELIX_EDITOR_SEED=<base64url seed> node scripts/transcribe.mjs https://getwetware.xyz pdb:1M17 claims.json
```

## Develop and deploy

```bash
npm install
npm run gen          # after editing DISCLAIMER, genome.json or ooc/helix.og
npm test             # algebra against genome.json roots, renderer, validation, index checksum
npm run typecheck
# Deploy the sealer first: it defines the Store the others bind.
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=f1cf1e721345291c47b6c92dbd2a3762 npm run deploy:sealer
npm run deploy:verifier
npm run deploy:endpoint
```

## Not implemented

- Chain rows (`dna:` pages). `genome.json` `chain` is `null`, so every `dna:` template claim is refused `unknown_locus`, as the contract requires. Reading `Bases` with `eth_call` lands with the deployment of `Bases`.
- The ooc index keeps the repository's route nodes and changelog verbatim and regenerates only the page rows and nodes.
