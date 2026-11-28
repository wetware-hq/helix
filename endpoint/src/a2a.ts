// A2A v1.0 JSON-RPC binding for the endpoint (POST /a2a). It carries the same read and
// edit skills as the HTTP routes: each SendMessage is answered by dispatching the
// equivalent /wiki request and wrapping the HTTP result in an agent Message. No task
// is ever created, so every answer is a Message.
import { MAX_BODY, readBody } from "./lib/x402";

type Dispatch = (request: Request) => Promise<Response>;

type Part = { text?: string; data?: unknown; mediaType?: string };
type Message = {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: string;
  parts: Part[];
};

export const A2A_VERSION = "1.0";

const ERR = {
  parse: [-32700, "Invalid JSON payload"],
  request: [-32600, "Request payload validation error"],
  method: [-32601, "Method not found"],
  params: [-32602, "Invalid parameters"],
  task: [-32001, "Task not found"],
  unsupported: [-32004, "Unsupported operation"],
  card: [-32007, "Extended agent card not configured"],
  version: [-32009, "Version not supported"],
} as const;

type Id = string | number | null;

type Reply = Record<string, unknown>;

function rpcError(id: Id, which: keyof typeof ERR, reason?: string): Reply {
  const [code, message] = ERR[which];
  const error: Record<string, unknown> = { code, message };
  if (reason) {
    error.data = [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "getwetware.xyz" }];
  }
  return { jsonrpc: "2.0", id, error };
}

function rpcResult(id: Id, result: unknown): Reply {
  return { jsonrpc: "2.0", id, result };
}

/** This binding serves A2A 1.0 only; an empty version means 0.3, which it does not serve. */
export function versionOk(v: string | null): boolean {
  return v !== null && v.trim() === A2A_VERSION;
}

export type HelixAsk = { skill: "read" | "edit"; id: string; accept?: "json"; payment?: string };

/** The helix request a message asks for: a data part, or a text part that is a page ID. */
export function askOf(message: unknown): HelixAsk | null {
  const parts = (message as { parts?: unknown })?.parts;
  if (!Array.isArray(parts)) return null;
  for (const p of parts as Part[]) {
    const d = p?.data as Record<string, unknown> | undefined;
    if (d && typeof d === "object" && typeof d.id === "string") {
      const skill = d.skill ?? "read";
      if (skill !== "read" && skill !== "edit") return null;
      const payment =
        typeof d.payment === "string"
          ? d.payment
          : d.payment && typeof d.payment === "object"
            ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d.payment))))
            : undefined;
      return { skill, id: d.id, accept: d.accept === "json" ? "json" : undefined, payment };
    }
  }
  for (const p of parts as Part[]) {
    if (typeof p?.text === "string" && /^\S+:\S+$/.test(p.text.trim())) {
      return { skill: "read", id: p.text.trim() };
    }
  }
  return null;
}

const KEEP = ["Helix-Root", "Helix-Renderer", "Helix-Disclaimer", "Helix-Content", "Retry-After"];

function decodeB64Json(s: string | null): unknown {
  if (!s) return undefined;
  try {
    const raw = atob(s);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

/** Wrap one HTTP answer from the wiki as the parts of an agent Message. */
export async function partsOf(res: Response): Promise<Part[]> {
  const headers: Record<string, string> = {};
  for (const h of KEEP) {
    const v = res.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  const meta: Record<string, unknown> = { status: res.status, headers };
  const settle = decodeB64Json(res.headers.get("PAYMENT-RESPONSE"));
  if (settle !== undefined) meta.settle = settle;

  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (type.startsWith("text/markdown")) {
    return [
      { text, mediaType: "text/markdown" },
      { data: meta, mediaType: "application/json" },
    ];
  }
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: keep the text
  }
  return [{ data: { ...meta, body }, mediaType: "application/json" }];
}

export async function a2a(request: Request, origin: string, dispatch: Dispatch): Promise<Response> {
  if (!versionOk(request.headers.get("A2A-Version") ?? new URL(request.url).searchParams.get("A2A-Version"))) {
    return Response.json(rpcError(null, "version", "a2a_version"));
  }
  const raw = await readBody(request, MAX_BODY);
  if (raw === null) return Response.json(rpcError(null, "request", "too_large"));
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json(rpcError(null, "parse"));
  }
  // A JSON-RPC batch is answered in order, one call after another, so edits keep their order.
  if (Array.isArray(body)) {
    if (body.length === 0) return Response.json(rpcError(null, "request"));
    const replies: Reply[] = [];
    for (const call of body) replies.push(await one(call, origin, dispatch));
    return Response.json(replies);
  }
  return Response.json(await one(body, origin, dispatch));
}

type Call = { jsonrpc?: string; id?: Id; method?: unknown; params?: Record<string, unknown> };

async function one(call: unknown, origin: string, dispatch: Dispatch): Promise<Reply> {
  const rpc = (call && typeof call === "object" ? call : null) as Call | null;
  const id: Id = rpc && (typeof rpc.id === "string" || typeof rpc.id === "number") ? rpc.id : null;
  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return rpcError(id, "request");

  switch (rpc.method) {
    case "SendMessage":
      break;
    case "GetTask":
    case "CancelTask":
      return rpcError(id, "task", "no_tasks");
    case "ListTasks":
      return rpcResult(id, { tasks: [], nextPageToken: "", pageSize: 0, totalSize: 0 });
    case "SendStreamingMessage":
    case "SubscribeToTask":
    case "CreateTaskPushNotificationConfig":
    case "GetTaskPushNotificationConfig":
    case "ListTaskPushNotificationConfigs":
    case "DeleteTaskPushNotificationConfig":
      return rpcError(id, "unsupported");
    case "GetExtendedAgentCard":
      return rpcError(id, "card");
    default:
      return rpcError(id, "method");
  }

  const message = rpc.params?.message as Message | undefined;
  const ask = askOf(message);
  if (!message || !ask) return rpcError(id, "params", "need_helix_request");
  if (typeof message.taskId === "string" && message.taskId !== "") return rpcError(id, "task", "no_tasks");

  // A client that accepts JSON but not Markdown gets the locus.
  const modes = (rpc.params?.configuration as { acceptedOutputModes?: unknown } | undefined)?.acceptedOutputModes;
  if (Array.isArray(modes) && modes.length > 0) {
    const takes = (m: string) => modes.some((x) => x === m || x === m.split("/")[0] + "/*" || x === "*/*");
    if (!takes("text/markdown") && takes("application/json")) ask.accept = "json";
  }

  const url = `${origin}/wiki/${ask.id}`;
  const headers: Record<string, string> = {};
  if (ask.accept === "json") headers.Accept = "application/json";
  if (ask.payment) headers["PAYMENT-SIGNATURE"] = ask.payment;
  const res = await dispatch(new Request(url, { method: ask.skill === "read" ? "GET" : "POST", headers }));

  const reply: Message = {
    messageId: crypto.randomUUID(),
    role: "ROLE_AGENT",
    parts: await partsOf(res),
  };
  if (typeof message.contextId === "string") reply.contextId = message.contextId;
  return rpcResult(id, { message: reply });
}
