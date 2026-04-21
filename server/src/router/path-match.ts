/**
 * Tiny path matcher for route patterns like `/api/agents/:id/quality`.
 *
 * - Static segments must match exactly.
 * - `:name` captures a segment into `params[name]`.
 * - Trailing slashes are ignored on both template and path.
 *
 * Matcher compiles once per template and returns a closure that takes a path
 * and returns `{ params }` on match or `null` on mismatch.
 */

export type PathMatcher = (pathname: string) => Record<string, string> | null;

interface Segment {
  kind: "static" | "param";
  value: string;
}

function stripTrailingSlash(s: string): string {
  return s.length > 1 && s.endsWith("/") ? s.slice(0, -1) : s;
}

function parseTemplate(template: string): Segment[] {
  const normalized = stripTrailingSlash(template);
  const parts = normalized.split("/");
  return parts.map((p) => {
    if (p.startsWith(":")) return { kind: "param", value: p.slice(1) };
    return { kind: "static", value: p };
  });
}

export function compilePath(template: string): PathMatcher {
  const segments = parseTemplate(template);
  return (pathname: string) => {
    const normalized = stripTrailingSlash(pathname);
    const parts = normalized.split("/");
    if (parts.length !== segments.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const part = parts[i];
      if (seg.kind === "static") {
        if (seg.value !== part) return null;
      } else {
        if (part.length === 0) return null;
        params[seg.value] = decodeURIComponent(part);
      }
    }
    return params;
  };
}
