// RFC 8785 JSON Canonicalization Scheme.
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function str(s: string): string {
  return JSON.stringify(s);
}

function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error("jcs: non-finite number");
  return JSON.stringify(n);
}

export function jcs(v: Json): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      return num(v);
    case "string":
      return str(v);
  }
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  keys.sort(compareKeys);
  return "{" + keys.map((k) => str(k) + ":" + jcs(v[k])).join(",") + "}";
}

// RFC 8785 sorts object keys by their UTF-16 code units.
function compareKeys(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}
