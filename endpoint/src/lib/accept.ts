// True when the Accept header ranks application/json above text/markdown.
export function wantsJson(request: Request): boolean {
  const ranges = (request.headers.get("Accept") ?? "").split(",").map((r) => {
    const [type, ...params] = r.split(";").map((x) => x.trim().toLowerCase());
    const q = params.find((x) => x.startsWith("q="));
    const n = q ? Number(q.slice(2)) : 1;
    return { type, q: Number.isFinite(n) ? n : 0 };
  });
  const quality = (type: string): number => {
    const [major] = type.split("/");
    const exact = ranges.find((r) => r.type === type);
    if (exact) return exact.q;
    const partial = ranges.find((r) => r.type === `${major}/*`);
    if (partial) return partial.q;
    return ranges.find((r) => r.type === "*/*")?.q ?? 0;
  };
  const json = quality("application/json");
  return json > 0 && json > quality("text/markdown");
}
