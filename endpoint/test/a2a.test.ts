import { describe, expect, it } from "vitest";
import { a2a, askOf, versionOk } from "../src/a2a";

const rpc = (method: string, params: unknown = {}, headers: Record<string, string> = {}) =>
  new Request("https://getwetware.xyz/a2a", {
    method: "POST",
    headers: { "content-type": "application/json", "A2A-Version": "1.0", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
  });

const seen: Request[] = [];
const dispatch = async (r: Request) => {
  seen.push(r);
  return new Response("# `uniprot:P00533`\n", {
    headers: { "content-type": "text/markdown; charset=utf-8", "Helix-Root": "abc" },
  });
};

describe("A2A JSON-RPC binding", () => {
  it("reads a page named by a text part", async () => {
    const msg = { messageId: "m1", role: "ROLE_USER", parts: [{ text: "uniprot:P00533" }], contextId: "c1" };
    const res = await (await a2a(rpc("SendMessage", { message: msg }), "https://getwetware.xyz", dispatch)).json();
    expect(seen.at(-1)!.url).toBe("https://getwetware.xyz/wiki/uniprot:P00533");
    expect(seen.at(-1)!.method).toBe("GET");
    const reply = (res as any).result.message;
    expect(reply.role).toBe("ROLE_AGENT");
    expect(reply.contextId).toBe("c1");
    expect(reply.parts[0]).toEqual({ text: "# `uniprot:P00533`\n", mediaType: "text/markdown" });
    expect(reply.parts[1].data.headers["Helix-Root"]).toBe("abc");
  });

  it("turns an edit data part into a POST carrying the payment", async () => {
    const msg = {
      messageId: "m2",
      role: "ROLE_USER",
      parts: [{ data: { skill: "edit", id: "pdb:1M17", payment: "eyJ4IjoxfQ==" } }],
    };
    await a2a(rpc("SendMessage", { message: msg }), "https://getwetware.xyz", dispatch);
    expect(seen.at(-1)!.method).toBe("POST");
    expect(seen.at(-1)!.headers.get("PAYMENT-SIGNATURE")).toBe("eyJ4IjoxfQ==");
  });

  it("answers task, streaming and unknown methods with A2A error codes", async () => {
    const code = async (m: string) =>
      ((await (await a2a(rpc(m), "https://getwetware.xyz", dispatch)).json()) as any).error.code;
    expect(await code("GetTask")).toBe(-32001);
    expect(await code("SendStreamingMessage")).toBe(-32004);
    expect(await code("message/send")).toBe(-32601);
    const list = (await (await a2a(rpc("ListTasks"), "x", dispatch)).json()) as any;
    expect(list.result).toEqual({ tasks: [], nextPageToken: "", pageSize: 50, totalSize: 0 });
    const bad = await a2a(rpc("SendMessage", { message: { parts: [{ text: "hello" }] } }), "x", dispatch);
    expect(((await bad.json()) as any).error.code).toBe(-32602);
  });

  it("reads the locus when only JSON output is accepted", async () => {
    const msg = { messageId: "m4", role: "ROLE_USER", parts: [{ text: "uniprot:P00533" }] };
    const params = { message: msg, configuration: { acceptedOutputModes: ["application/json"] } };
    await a2a(rpc("SendMessage", params), "https://getwetware.xyz", dispatch);
    expect(seen.at(-1)!.headers.get("Accept")).toBe("application/json");
  });

  it("refuses a message bound to a task, without dispatching", async () => {
    const before = seen.length;
    const msg = { messageId: "m3", role: "ROLE_USER", taskId: "t1", parts: [{ data: { skill: "edit", id: "pdb:1M17" } }] };
    const res = await a2a(rpc("SendMessage", { message: msg }), "x", dispatch);
    expect(((await res.json()) as any).error.code).toBe(-32001);
    expect(seen.length).toBe(before);
  });

  it("refuses an unsupported A2A-Version", async () => {
    expect(versionOk("1.0")).toBe(true);
    expect(versionOk(null)).toBe(false);
    expect(versionOk("1.1")).toBe(false);
    expect(versionOk("0.3")).toBe(false);
    const res = await a2a(rpc("SendMessage", {}, { "A2A-Version": "0.3" }), "x", dispatch);
    expect(((await res.json()) as any).error.code).toBe(-32009);
  });

  it("answers a JSON-RPC batch in order", async () => {
    const call = (id: number, text: string) => ({
      jsonrpc: "2.0", id, method: "SendMessage",
      params: { message: { messageId: "b" + id, role: "ROLE_USER", parts: [{ text }] } },
    });
    const req = new Request("https://getwetware.xyz/a2a", {
      method: "POST",
      headers: { "A2A-Version": "1.0" },
      body: JSON.stringify([call(1, "uniprot:P00533"), call(2, "hgnc:3236")]),
    });
    const out = (await (await a2a(req, "https://getwetware.xyz", dispatch)).json()) as any[];
    expect(out.map((r) => r.id)).toEqual([1, 2]);
    expect(seen.at(-1)!.url).toBe("https://getwetware.xyz/wiki/hgnc:3236");
  });

  it("finds no helix request in prose", () => {
    expect(askOf({ parts: [{ text: "tell me about EGFR" }] })).toBe(null);
  });
});

