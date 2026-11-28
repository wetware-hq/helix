// The store: one Durable Object instance is the genome and its single lock
// (systems/seal-page.md "one store lock"). Pages, receipts, spent nonces and
// live offers are separate keys, so no single value has to hold the whole genome.
import { DurableObject } from "cloudflare:workers";
import { buildIndex } from "./lib/og";
import { GENOME_SEED } from "./generated/static";
import {
  cid, foldRoot, rootEmpty, type Chain, type Claim, type Genome, type Locus, type Receipt, type Roles,
} from "./lib/model";

export type SettleInput = {
  id: string;
  editor: string;
  verifier: string;
  sealer: string;
  parent: string;
  nonce: string;
  expires: string;
  key: string;
  rnaDigest: string;
  append: Claim[];
  /** The sealer's receipt and signed SettleResponse, stored with the append in one put. */
  receipt: Receipt;
  response: Record<string, unknown>;
};

export type SettleOutcome =
  | { state: "sealed" | "receipt"; receipt: Receipt; response?: Record<string, unknown> }
  | { state: "fail"; code: string };

export type Env = { STORE: DurableObjectNamespace<Store>; HELIX_SEED?: string };

export class Store extends DurableObject {
  async init(): Promise<void> {
    if (await this.ctx.storage.get("helix")) return;
    // One put is atomic, so a store is either fully seeded or not seeded at all.
    const seed: Record<string, unknown> = {
      helix: 1,
      roles: GENOME_SEED.roles,
      chain: GENOME_SEED.chain,
      ids: Object.keys(GENOME_SEED.loci),
      updated: new Date().toISOString().slice(0, 10),
    };
    for (const [id, locus] of Object.entries(GENOME_SEED.loci)) seed["locus:" + id] = locus;
    await this.ctx.storage.put(seed);
  }

  async roles(): Promise<Roles> {
    await this.init();
    return (await this.ctx.storage.get<Roles>("roles"))!;
  }

  async chain(): Promise<Chain> {
    await this.init();
    return (await this.ctx.storage.get<Chain>("chain")) ?? null;
  }

  async locus(id: string): Promise<Locus | null> {
    await this.init();
    return (await this.ctx.storage.get<Locus>("locus:" + id)) ?? null;
  }

  async genome(): Promise<Genome> {
    await this.init();
    const ids = (await this.ctx.storage.get<string[]>("ids")) ?? [];
    const loci: Record<string, Locus> = {};
    for (const id of ids) {
      const locus = await this.ctx.storage.get<Locus>("locus:" + id);
      if (locus) loci[id] = locus;
    }
    return {
      helix: 1,
      roles: await this.roles(),
      chain: await this.chain(),
      loci,
      receipts: {},
      spent: {},
    };
  }

  async index(): Promise<string> {
    const genome = await this.genome();
    const updated = (await this.ctx.storage.get<string>("updated"))!;
    return buildIndex(genome, updated);
  }

  async putOffer(nonce: string, offer: Record<string, unknown>, expires: string): Promise<void> {
    await this.ctx.storage.put("offer:" + nonce, { offer, expires });
    await this.sweepAt(Date.parse(expires));
  }

  /** Abandoned offers and spent nonces are dropped once their offer has expired. */
  async alarm(): Promise<void> {
    const now = Date.now();
    let next = Infinity;
    for (const prefix of ["offer:", "spent:"]) {
      const rows = await this.ctx.storage.list<{ expires: string } | string>({ prefix });
      const stale: string[] = [];
      for (const [k, v] of rows) {
        const at = Date.parse(typeof v === "string" ? v : v.expires);
        if (at <= now) stale.push(k);
        else next = Math.min(next, at);
      }
      for (let i = 0; i < stale.length; i += 128) await this.ctx.storage.delete(stale.slice(i, i + 128));
    }
    if (next !== Infinity) await this.ctx.storage.setAlarm(next + 1000);
  }

  private async sweepAt(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at + 1000) await this.ctx.storage.setAlarm(at + 1000);
  }

  async getOffer(nonce: string): Promise<Record<string, unknown> | null> {
    const row = await this.ctx.storage.get<{ offer: Record<string, unknown>; expires: string }>(
      "offer:" + nonce,
    );
    if (!row) return null;
    if (Date.parse(row.expires) < Date.now()) {
      await this.ctx.storage.delete("offer:" + nonce);
      return null;
    }
    return row.offer;
  }

  /** The stored receipt for an editor's idempotency key, with its signed response once issued. */
  async receipt(
    editor: string,
    key: string,
  ): Promise<{ rna: string; receipt: Receipt; response?: Record<string, unknown> } | null> {
    return (await this.ctx.storage.get("receipt:" + editor + ":" + key)) ?? null;
  }

  /**
   * systems/seal-page.md: the whole settle runs here, so the receipt lookup, nonce,
   * parent and duplicate checks and the append cannot interleave with another edit.
   * Signatures, roles and key separation are checked by the sealer before this call.
   */
  async settle(input: SettleInput): Promise<SettleOutcome> {
    await this.init();
    const receiptKey = "receipt:" + input.editor + ":" + input.key;
    const stored = await this.ctx.storage.get<{
      rna: string;
      receipt: Receipt;
      response?: Record<string, unknown>;
    }>(receiptKey);
    if (stored) {
      if (stored.rna === input.rnaDigest) {
        return { state: "receipt", receipt: stored.receipt, response: stored.response };
      }
      return { state: "fail", code: "replay" };
    }
    if (await this.ctx.storage.get("spent:" + input.nonce)) return { state: "fail", code: "expired" };
    if (Date.parse(input.expires) < Date.now()) return { state: "fail", code: "expired" };

    const locus: Locus = (await this.locus(input.id)) ?? { claims: [], root: await rootEmpty() };
    if (input.parent !== locus.root) return { state: "fail", code: "stale_parent" };

    const have = new Set(await Promise.all(locus.claims.map(cid)));
    const adding = await Promise.all(input.append.map(cid));
    for (const c of adding) {
      if (have.has(c)) return { state: "fail", code: "duplicate" };
      have.add(c);
    }

    let root = locus.root;
    for (const c of input.append) root = await foldRoot(root, c);
    const next: Locus = { claims: [...locus.claims, ...input.append], root };

    const receipt = input.receipt;
    if (
      receipt.root !== root || receipt.rna !== input.rnaDigest || receipt.id !== input.id ||
      receipt.editor !== input.editor || receipt.verifier !== input.verifier || receipt.sealer !== input.sealer
    ) {
      return { state: "fail", code: "bad_envelope" };
    }

    const ids = (await this.ctx.storage.get<string[]>("ids")) ?? [];
    if (!ids.includes(input.id)) ids.push(input.id);

    await this.ctx.storage.put({
      ["locus:" + input.id]: next,
      ids,
      updated: receipt.at.slice(0, 10),
      [receiptKey]: { rna: input.rnaDigest, receipt, response: input.response },
      ["spent:" + input.nonce]: input.expires,
    });
    await this.ctx.storage.delete("offer:" + input.nonce);
    await this.sweepAt(Date.parse(input.expires));
    return { state: "sealed", receipt, response: input.response };
  }
}

export function store(env: Env): DurableObjectStub<Store> {
  return env.STORE.get(env.STORE.idFromName("genome"));
}
