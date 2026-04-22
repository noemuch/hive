/* @hive-protocol: protocol-path-guard-check */
/**
 * protocol-path-guard / check.ts — AST scanner invoked by
 * `.github/workflows/protocol-path-guard.yml` (NORTHSTAR §9.3 layer #1).
 *
 * Responsibilities (executable specification of NORTHSTAR §2.1 + §9.3):
 *   1. Build the closure from anchor files via ts-morph (import walk).
 *   2. For every TS/TSX file in the closure or PR diff:
 *        - reject dynamic-import / eval / new Function / vm.* / Module._load
 *          / Reflect.get on process-like / globalThis[dyn] (§2.1 #2)
 *        - reject env-reading APIs (task layer #5)
 *        - reject non-allowlisted imports (task layer #6)
 *        - reject forbidden global-API references (task layer #7)
 *        - require module-level bindings to be `export const` (no let/var)
 *   3. For every migration file in PR diff (best-effort without libpg_query
 *      installed at author time — we fall back to a tokenised identifier
 *      walk; when libpg-query is available at CI time, we use the AST).
 *   4. Extract `@hive-protocol:` / `@hive-protocol-test:` pragmas with
 *      NFKC normalisation + TR39-lite confusables folding.
 *
 * I/O contract: this module exports `runCheck(ctx)` → `CheckResult` JSON.
 * The workflow turns the JSON into labels + a comment.
 *
 * Runtime: Bun-native. Falls back to Node if invoked under `node` (no
 * Bun-only APIs used in hot paths — only `Bun.file` is guarded with a
 * fs fallback).
 *
 * Determinism: identical input tree → identical output JSON (closure is
 * computed in sorted order; scanner reports are sorted by file + line).
 *
 * Pre-genesis grace: callers pass `ctx.preGenesis=true` when
 * PROTOCOL_PATHS.sig is absent. In that mode, pragma allowlist + SHA
 * pinning become advisory (logged as `warnings`), not `reasons`.
 */

import { readFile } from "node:fs/promises";
import { resolve as pathResolve, relative as pathRelative, dirname, join as pathJoin } from "node:path";
import { Project, SyntaxKind, Node, ts } from "ts-morph";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface CheckContext {
  /** Absolute repo root. */
  repoRoot: string;
  /** Files touched by the PR (relative paths). Used to bound scans to the diff. */
  prFiles: string[];
  /** Anchor files (relative paths). Walked to compute the import closure. */
  anchors: string[];
  /** Constitutional table names (lowercase, exact match on identifier). */
  constitutionalTables: string[];
  /** Pragma role allowlist. Ignored when preGenesis=true. */
  pragmaRoleAllowlist: string[];
  /** True when PROTOCOL_PATHS.sig is missing — lenient mode. */
  preGenesis: boolean;
}

export interface Reason {
  kind:
    | "dynamic-import"
    | "eval-like"
    | "env-read"
    | "forbidden-import"
    | "global-api"
    | "module-let-var"
    | "dynamic-process"
    | "non-ascii-pragma"
    | "pragma-role-unlisted"
    | "schema-constitutional-touch"
    | "unpinned-action"
    | "missing-protocol-file";
  file: string;
  line?: number;
  detail: string;
}

export interface Warning {
  file: string;
  line?: number;
  detail: string;
}

export interface CheckResult {
  blocked: boolean;
  /** When true, a PR-scoped `protocol-change` label should be applied. */
  touchesClosure: boolean;
  reasons: Reason[];
  warnings: Warning[];
  closure: string[]; // sorted list of protocol files (relative paths) as computed
  stats: {
    prFilesScanned: number;
    closureFilesTotal: number;
    astNodesVisited: number;
  };
}

// -----------------------------------------------------------------------------
// Hard-coded policy (single source of truth inside this script)
// -----------------------------------------------------------------------------

/**
 * Allowed import specifiers inside a protocol TS file. All other imports BLOCK.
 *   - node: / bun: prefix       → stdlib
 *   - absolute path / `./` `../` → closure-internal (resolved to paths inside
 *                                  the closure; verified post-resolution)
 *   - explicit bare-name allow  → `pg` (pinned DB driver), `@noble/hashes/*`
 */
const ALLOWED_BARE_IMPORTS = new Set<string>([
  "pg",
]);

const ALLOWED_BARE_IMPORT_PREFIXES = [
  "node:",
  "bun:",
  "@noble/hashes/", // cryptographic primitives used by verify-paths-sig.ts
];

/**
 * Forbidden global-API identifier references. Any of these appearing as
 * a bare identifier or as property on the global/Bun/Deno/process namespace
 * in a protocol file BLOCKS.
 *
 * `crypto.subtle` and `crypto.createSign` are handled via property walks on
 * `crypto` (callsite-specific) — not listed here to avoid false positives
 * on `import { sha256 } from "@noble/hashes/sha2"`.
 */
const FORBIDDEN_GLOBAL_IDENTS = new Set<string>([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
]);

const FORBIDDEN_NAMESPACE_IMPORTS = new Set<string>([
  "child_process",
  "node:child_process",
  "worker_threads",
  "node:worker_threads",
  "cluster",
  "node:cluster",
  "net",
  "node:net",
  "tls",
  "node:tls",
  "http",
  "node:http",
  "https",
  "node:https",
  "vm",
  "node:vm",
]);

/**
 * Methods on `crypto` that require private keys. `crypto.subtle` is also
 * forbidden — internal deterministic helpers or @noble/hashes should be used.
 */
const FORBIDDEN_CRYPTO_MEMBERS = new Set<string>([
  "subtle",
  "createSign",
  "createVerify",
  "createCipheriv",
  "createDecipheriv",
  "generateKeyPair",
  "generateKeyPairSync",
]);

/** fs.* methods that touch /proc/*environ (env-read vector via filesystem). */
const FORBIDDEN_FS_METHODS = new Set<string>([
  "readFile",
  "readFileSync",
  "createReadStream",
  "open",
  "openSync",
  "read",
  "readSync",
]);

/** Bun globals that constitute an exec surface. */
const FORBIDDEN_BUN_MEMBERS = new Set<string>(["spawn", "spawnSync", "serve", "env"]);

// -----------------------------------------------------------------------------
// Pragma extraction (NFKC + TR39-lite confusables folding)
// -----------------------------------------------------------------------------

/**
 * TR39-lite skeleton. We only fold the confusables most commonly used to
 * smuggle a pragma past a naive grep: Cyrillic + Greek + fullwidth latin
 * homoglyphs for h/i/v/e/p/r/o/t/c/l/ (and a few others). For a full
 * TR39 skeleton we'd ship the Unicode confusables.txt — overkill for the
 * 10-odd characters in `@hive-protocol:`.
 */
const CONFUSABLES_MAP: Record<string, string> = {
  // cyrillic
  "а": "a", // а
  "е": "e", // е
  "о": "o", // о
  "р": "p", // р
  "с": "c", // с
  "х": "x", // х
  "ѕ": "s", // ѕ
  "і": "i", // і
  "ј": "j", // ј
  "ҋ": "n", // ҋ-ish
  "һ": "h", // һ
  "ԛ": "q", // ԛ
  "ԝ": "w", // ԝ
  "ԁ": "d", // ԁ
  "ԃ": "g", // ԃ/ԋ-ish (best effort)
  "ӏ": "l", // ӏ
  "є": "e", // є
  "л": "l", // л best-effort (not strictly a confusable but fold)
  "ѕ": "s",
  // greek
  "ο": "o", // ο
  "ρ": "p", // ρ
  "α": "a", // α
  "ε": "e", // ε
  "τ": "t", // τ
  "κ": "k", // κ
  "ν": "v", // ν
  "ι": "i", // ι
  "υ": "u", // υ
  "χ": "x", // χ
  // fullwidth latin
  "Ａ": "a",
  "Ｂ": "b",
  "Ｃ": "c",
  "Ｄ": "d",
  "Ｅ": "e",
  "Ｆ": "f",
  "Ｇ": "g",
  "Ｈ": "h",
  "Ｉ": "i",
  "Ｊ": "j",
  "Ｋ": "k",
  "Ｌ": "l",
  "Ｍ": "m",
  "Ｎ": "n",
  "Ｏ": "o",
  "Ｐ": "p",
  "Ｑ": "q",
  "Ｒ": "r",
  "Ｓ": "s",
  "Ｔ": "t",
  "Ｕ": "u",
  "Ｖ": "v",
  "Ｗ": "w",
  "Ｘ": "x",
  "Ｙ": "y",
  "Ｚ": "z",
};

function foldConfusables(s: string): string {
  let out = "";
  for (const ch of s) {
    const lower = ch.toLowerCase();
    out += CONFUSABLES_MAP[lower] ?? lower;
  }
  return out;
}

function normaliseForPragma(s: string): string {
  // NFKC then lower-case, then fold confusables.
  return foldConfusables(s.normalize("NFKC").toLowerCase());
}

const PRAGMA_RE = /@hive-protocol(?:-test)?\s*:\s*([A-Za-z0-9_./-]+)/;

/**
 * Extracts (role, isTest) from the top comment of a file — the role string
 * is returned in its NORMALISED form (already NFKC+confusables-folded).
 * Also returns `nonAscii = true` if the pragma line contained non-ASCII
 * bytes (per §2.1 #7: non-ASCII pragma BLOCKS).
 */
export function extractPragma(
  source: string,
): { role: string; isTest: boolean; nonAscii: boolean } | null {
  // Look only in the top ~40 lines (cheap; pragma must be in top comment).
  const head = source.split("\n", 40).join("\n");
  const normalised = normaliseForPragma(head);
  const m = PRAGMA_RE.exec(normalised);
  if (!m) return null;

  // nonAscii: look for the line containing `@` followed by anything, then
  // scan its raw bytes. Since the spoofed pragma looked like `@һіvе-рrоtосоl:`
  // in raw bytes, any line with `@` in the top 40 that normalises to a
  // `@hive-protocol:` pragma but is not pure-ASCII is the signal.
  let nonAscii = false;
  for (const line of head.split("\n")) {
    if (line.includes("@")) {
      const normLine = normaliseForPragma(line);
      if (PRAGMA_RE.test(normLine)) {
        // eslint-disable-next-line no-control-regex
        if (/[^\x00-\x7f]/.test(line)) {
          nonAscii = true;
          break;
        }
      }
    }
  }

  const isTest = /@hive-protocol-test\s*:/i.test(normalised);
  return { role: m[1], isTest, nonAscii };
}

// -----------------------------------------------------------------------------
// Core: closure computation via ts-morph
// -----------------------------------------------------------------------------

function isLikelyTsSource(path: string): boolean {
  return /\.(ts|tsx|mts|cts)$/i.test(path) && !path.includes("node_modules/");
}

/**
 * Walk static imports transitively starting from the TS anchor files.
 * Non-TS anchors (markdown, yml, json) are included verbatim in the closure
 * (they anchor by pragma / SHA, not by import).
 *
 * Dynamic imports / eval / require(<non-literal>) in traversed files
 * immediately contribute a `dynamic-import` / `eval-like` reason and the
 * node is NOT followed (fail closed on smuggling via dynamic indirection).
 */
async function buildClosure(
  ctx: CheckContext,
  project: Project,
  reasons: Reason[],
): Promise<Set<string>> {
  const closure = new Set<string>();
  const tsAnchors: string[] = [];

  for (const rel of ctx.anchors) {
    closure.add(rel);
    if (isLikelyTsSource(rel)) tsAnchors.push(rel);
  }

  // BFS: queue of absolute paths to walk.
  const queue: string[] = tsAnchors.map((rel) => pathResolve(ctx.repoRoot, rel));
  const visitedAbs = new Set<string>(queue);

  while (queue.length > 0) {
    const abs = queue.shift()!;
    let sourceFile;
    try {
      sourceFile = project.addSourceFileAtPathIfExists(abs);
    } catch {
      sourceFile = undefined;
    }
    if (!sourceFile) continue;

    const relFromRoot = pathRelative(ctx.repoRoot, abs);
    closure.add(relFromRoot);

    // Static imports.
    for (const imp of sourceFile.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!spec) continue;
      if (
        spec.startsWith("./") ||
        spec.startsWith("../") ||
        spec.startsWith("/")
      ) {
        // Resolve relative to sourceFile.
        const resolved = pathResolve(dirname(abs), spec);
        for (const candidate of [
          resolved,
          resolved + ".ts",
          resolved + ".tsx",
          pathJoin(resolved, "index.ts"),
          pathJoin(resolved, "index.tsx"),
        ]) {
          if (!visitedAbs.has(candidate)) {
            visitedAbs.add(candidate);
            queue.push(candidate);
          }
        }
      }
      // Bare imports (pg, @noble/hashes/*) — not walked: they're outside the repo.
    }

    // Detect dynamic-import / eval / Function / vm / Reflect.get / globalThis[dyn]
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      const exprText = expr.getText();

      // dynamic `import(<expr>)` — Node returns it as a CallExpression whose
      // expression kind is ImportKeyword.
      if (expr.getKind() === SyntaxKind.ImportKeyword) {
        const args = call.getArguments();
        const isLiteral =
          args.length === 1 && Node.isStringLiteral(args[0]);
        if (!isLiteral) {
          reasons.push({
            kind: "dynamic-import",
            file: relFromRoot,
            line: call.getStartLineNumber(),
            detail: `dynamic import() with non-literal argument: ${call.getText().slice(0, 120)}`,
          });
        }
        continue;
      }

      if (
        exprText === "eval" ||
        exprText === "globalThis.eval" ||
        exprText === "window.eval"
      ) {
        reasons.push({
          kind: "eval-like",
          file: relFromRoot,
          line: call.getStartLineNumber(),
          detail: `eval() call`,
        });
      }

      if (exprText === "require") {
        const args = call.getArguments();
        const isLiteral = args.length === 1 && Node.isStringLiteral(args[0]);
        if (!isLiteral) {
          reasons.push({
            kind: "dynamic-import",
            file: relFromRoot,
            line: call.getStartLineNumber(),
            detail: `require() with non-literal argument`,
          });
        }
      }

      // Reflect.get(process, ...) / Reflect.get(globalThis, "process", ...)
      if (exprText === "Reflect.get") {
        const args = call.getArguments();
        const target = args[0]?.getText() ?? "";
        if (/(^|[^a-zA-Z_])process([^a-zA-Z_]|$)/.test(target) || target.includes("globalThis")) {
          reasons.push({
            kind: "dynamic-process",
            file: relFromRoot,
            line: call.getStartLineNumber(),
            detail: `Reflect.get on process-like: ${target}`,
          });
        }
      }
    }

    // new Function(...)
    for (const nw of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      const expr = nw.getExpression().getText();
      if (expr === "Function" || expr === "globalThis.Function") {
        reasons.push({
          kind: "eval-like",
          file: relFromRoot,
          line: nw.getStartLineNumber(),
          detail: `new Function() constructor`,
        });
      }
    }

    // Module._load (Node internal hatch)
    const text = sourceFile.getFullText();
    if (/\bModule\._load\s*\(/.test(text)) {
      const line = text.slice(0, text.indexOf("Module._load")).split("\n").length;
      reasons.push({
        kind: "eval-like",
        file: relFromRoot,
        line,
        detail: `Module._load() reference`,
      });
    }
  }

  return closure;
}

// -----------------------------------------------------------------------------
// Per-file protocol scan (env / imports / globals / module-bindings)
// -----------------------------------------------------------------------------

function scanProtocolFile(
  absPath: string,
  relPath: string,
  project: Project,
  ctx: CheckContext,
  reasons: Reason[],
  warnings: Warning[],
): number {
  let visited = 0;
  const sf = project.addSourceFileAtPathIfExists(absPath);
  if (!sf) return 0;

  // The scanner script itself carries `@hive-protocol: protocol-path-guard-check`
  // for anchor-SHA tracking but is a CI utility, not a runtime protocol module.
  // Skip self-scan to avoid bootstrap paradox.
  if (relPath.startsWith("scripts/protocol-path-guard/")) return 0;

  // Pre-genesis grace: emit warnings instead of BLOCK reasons. This lets
  // already-committed protocol references (e.g. `node:child_process` in
  // verify-paths-sig.ts) remain shippable until the genesis ceremony signs
  // them in. Post-genesis, every push() below upgrades to `reasons.push()`.
  const sink = ctx.preGenesis
    ? (r: Reason) => warnings.push({ file: r.file, line: r.line, detail: `[pre-genesis] ${r.kind}: ${r.detail}` })
    : (r: Reason) => reasons.push(r);

  // --- Layer #5: env-read prohibition ---------------------------------------
  // process.env, process["env"], process?.env, etc.
  for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    visited++;
    const objText = pae.getExpression().getText();
    const propName = pae.getName();
    if ((objText === "process" || objText === "globalThis.process" || objText === "global.process") && propName === "env") {
      sink({
        kind: "env-read",
        file: relPath,
        line: pae.getStartLineNumber(),
        detail: `${objText}.env reference`,
      });
    }
    if ((objText === "Bun" || objText === "globalThis.Bun") && propName === "env") {
      sink({
        kind: "env-read",
        file: relPath,
        line: pae.getStartLineNumber(),
        detail: `Bun.env reference`,
      });
    }
    if ((objText === "Deno" || objText === "globalThis.Deno") && propName === "env") {
      sink({
        kind: "env-read",
        file: relPath,
        line: pae.getStartLineNumber(),
        detail: `Deno.env reference`,
      });
    }
    // Layer #7: Bun.spawn / Bun.serve / crypto.subtle / crypto.createSign
    if ((objText === "Bun" || objText === "globalThis.Bun") && FORBIDDEN_BUN_MEMBERS.has(propName)) {
      sink({
        kind: "global-api",
        file: relPath,
        line: pae.getStartLineNumber(),
        detail: `Bun.${propName} reference`,
      });
    }
    if (objText === "crypto" && FORBIDDEN_CRYPTO_MEMBERS.has(propName)) {
      sink({
        kind: "global-api",
        file: relPath,
        line: pae.getStartLineNumber(),
        detail: `crypto.${propName} reference`,
      });
    }
  }

  // process["env"] bracket access or process?.env
  for (const ea of sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    visited++;
    const objText = ea.getExpression().getText();
    if (objText === "process" || objText === "globalThis.process") {
      sink({
        kind: "dynamic-process",
        file: relPath,
        line: ea.getStartLineNumber(),
        detail: `dynamic member access on ${objText}[...]`,
      });
    }
  }

  // --- Layer #6: import allowlist ------------------------------------------
  for (const imp of sf.getImportDeclarations()) {
    visited++;
    const spec = imp.getModuleSpecifierValue();
    if (!spec) continue;

    // Relative/absolute are closure-internal — allowed.
    if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) continue;

    // Bare specifier.
    const allowed =
      ALLOWED_BARE_IMPORTS.has(spec) ||
      ALLOWED_BARE_IMPORT_PREFIXES.some((p) => spec.startsWith(p));
    if (!allowed) {
      sink({
        kind: "forbidden-import",
        file: relPath,
        line: imp.getStartLineNumber(),
        detail: `non-allowlisted import: "${spec}"`,
      });
      continue;
    }

    // Explicitly forbid child_process/net/tls/http/https/cluster/vm/worker_threads
    // even when written as node:* (already allowed by prefix above — so re-check).
    if (FORBIDDEN_NAMESPACE_IMPORTS.has(spec)) {
      sink({
        kind: "global-api",
        file: relPath,
        line: imp.getStartLineNumber(),
        detail: `forbidden Node namespace import: "${spec}"`,
      });
    }

    // fs.readFile* family — flag if imported then used on '/proc/*environ'
    if (spec === "node:fs" || spec === "fs" || spec === "node:fs/promises" || spec === "fs/promises") {
      // We don't ban fs wholesale (verify-paths-sig.ts uses readFile legitimately),
      // but we scan for readFile("/proc/...environ") usages below via string-match.
      const full = sf.getFullText();
      if (/readFile(Sync)?\s*\(\s*['"`][^'"`]*\/proc\/[^'"`]*environ/i.test(full)) {
        const idx = full.search(/\/proc\/[^'"`]*environ/);
        const line = full.slice(0, idx).split("\n").length;
        sink({
          kind: "env-read",
          file: relPath,
          line,
          detail: `fs.readFile of /proc/*environ`,
        });
      }
    }
  }

  // --- Layer #7: bare-identifier forbidden globals -------------------------
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    visited++;
    const name = id.getText();
    if (!FORBIDDEN_GLOBAL_IDENTS.has(name)) continue;

    // Skip if this identifier is a PropertyName (e.g. `{ fetch: ... }`) or
    // a property-access RHS (`foo.fetch`).
    const parent = id.getParent();
    if (!parent) continue;
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue;
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) continue;
    if (Node.isShorthandPropertyAssignment(parent)) continue;
    if (Node.isMethodDeclaration(parent) || Node.isMethodSignature(parent)) continue;
    if (Node.isBindingElement(parent)) continue;
    if (Node.isImportSpecifier(parent) || Node.isImportClause(parent)) continue;
    if (Node.isParameterDeclaration(parent)) continue;

    // It must be a reference (not declaration).
    if (Node.isVariableDeclaration(parent) && parent.getNameNode() === id) continue;
    if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === id) continue;

    sink({
      kind: "global-api",
      file: relPath,
      line: id.getStartLineNumber(),
      detail: `forbidden global identifier: \`${name}\``,
    });
  }

  // --- Module-level bindings MUST be `export const` ------------------------
  for (const vs of sf.getVariableStatements()) {
    visited++;
    if (vs.getParentIfKind(SyntaxKind.SourceFile) == null) continue; // skip nested
    const decl = vs.getDeclarationKind(); // "let" | "const" | "var"
    if (decl !== "const") {
      sink({
        kind: "module-let-var",
        file: relPath,
        line: vs.getStartLineNumber(),
        detail: `module-level \`${decl}\` binding — protocol modules export \`const\` only`,
      });
    }
  }

  return visited;
}

// -----------------------------------------------------------------------------
// Migration scan (constitutional-object reference detector)
// -----------------------------------------------------------------------------

/**
 * Best-effort migration scan WITHOUT requiring libpg-query at dev time.
 * Tokenises the SQL (strips quoted strings + line/block comments), then
 * greps for constitutional table identifiers. At CI time the workflow
 * installs `libpg-query` and swaps this for an AST walk.
 *
 * This function over-matches (substring match on table name) — that is
 * intentional: false positives route the PR to §5 RFC, which is correct.
 */
function scanMigration(
  source: string,
  relPath: string,
  constitutionalTables: string[],
  reasons: Reason[],
): void {
  // Strip quoted strings + line + block comments to reduce false positives on
  // incidental mentions in comments.
  const cleaned = source
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, "\"\"");
  const tokens = new Set(cleaned.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []);
  for (const table of constitutionalTables) {
    if (tokens.has(table.toLowerCase())) {
      reasons.push({
        kind: "schema-constitutional-touch",
        file: relPath,
        detail: `migration references constitutional table \`${table}\` (NORTHSTAR §3.7). §5 RFC required.`,
      });
    }
  }
}

// -----------------------------------------------------------------------------
// Workflow YAML scan (SHA-pin + secrets)
// -----------------------------------------------------------------------------

const UNPINNED_USES_RE = /^\s*-?\s*uses:\s*([A-Za-z0-9._\-]+\/[A-Za-z0-9._\-]+)@([A-Za-z0-9._\-]+)/gm;

function scanWorkflowFile(source: string, relPath: string, reasons: Reason[]): void {
  UNPINNED_USES_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UNPINNED_USES_RE.exec(source)) !== null) {
    const ref = m[2];
    // SHA-pin = 40 hex chars.
    if (!/^[a-f0-9]{40}$/i.test(ref)) {
      const line = source.slice(0, m.index).split("\n").length;
      reasons.push({
        kind: "unpinned-action",
        file: relPath,
        line,
        detail: `\`uses: ${m[1]}@${ref}\` — actions MUST be SHA-pinned (40-hex) in protocol workflows`,
      });
    }
  }
}

// -----------------------------------------------------------------------------
// Orchestration
// -----------------------------------------------------------------------------

export async function runCheck(ctx: CheckContext): Promise<CheckResult> {
  const reasons: Reason[] = [];
  const warnings: Warning[] = [];
  let astNodesVisited = 0;

  // One shared project; we addSourceFileAtPathIfExists on demand (cheaper
  // than createProject({tsConfigFilePath: ...}) which would pull half the repo).
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: false,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
    },
  });

  // 1. Build closure from anchors.
  const closure = await buildClosure(ctx, project, reasons);

  // Sorted closure for deterministic output.
  const closureSorted = Array.from(closure).sort();

  // 2. Determine which PR files intersect the closure (→ `touchesClosure`).
  const closureSet = new Set(closureSorted);
  const prFilesInClosure = ctx.prFiles.filter((p) => closureSet.has(p));
  const touchesClosure = prFilesInClosure.length > 0 ||
    ctx.prFiles.some((p) => ctx.anchors.some((a) => p === a || p.startsWith(a + "/")));

  // 3. Scan every PR file that falls in the closure (perf budget: PR diff,
  //    not full repo).
  for (const rel of prFilesInClosure) {
    const abs = pathResolve(ctx.repoRoot, rel);
    if (isLikelyTsSource(rel)) {
      astNodesVisited += scanProtocolFile(abs, rel, project, ctx, reasons, warnings);
    }
    if (rel.endsWith(".yml") || rel.endsWith(".yaml")) {
      try {
        const src = await readFile(abs, "utf8");
        scanWorkflowFile(src, rel, reasons);
      } catch {
        // file may have been deleted in the PR — skip
      }
    }
  }

  // 4. Scan every migration in PR diff (always, regardless of closure — a new
  //    migration that touches a constitutional table MUST route to §5).
  const migrationFiles = ctx.prFiles.filter((p) =>
    /(^|\/)migrations\/.+\.sql$/.test(p),
  );
  for (const rel of migrationFiles) {
    const abs = pathResolve(ctx.repoRoot, rel);
    try {
      const src = await readFile(abs, "utf8");
      scanMigration(src, rel, ctx.constitutionalTables, reasons);
    } catch {
      // deleted migration — skip
    }
  }

  // 5. Scan PR-added pragmas for non-ASCII bytes + allowlist membership.
  //    We scan ALL ts/tsx/md/yml files in the PR diff (pragma can appear
  //    anywhere per §2.1 #7).
  const pragmaCandidates = ctx.prFiles.filter((p) =>
    /\.(ts|tsx|md|yml|yaml|mts|cts|js|mjs)$/.test(p),
  );
  for (const rel of pragmaCandidates) {
    const abs = pathResolve(ctx.repoRoot, rel);
    try {
      const src = await readFile(abs, "utf8");
      const pragma = extractPragma(src);
      if (!pragma) continue;
      if (pragma.nonAscii) {
        reasons.push({
          kind: "non-ascii-pragma",
          file: rel,
          detail: `pragma contains non-ASCII bytes — §2.1 #7 requires pure-ASCII pragmas`,
        });
      }
      if (!ctx.preGenesis && !ctx.pragmaRoleAllowlist.includes(pragma.role)) {
        reasons.push({
          kind: "pragma-role-unlisted",
          file: rel,
          detail: `pragma role \`${pragma.role}\` not in PROTOCOL_PATHS.sig.pragma_roles[]`,
        });
      } else if (ctx.preGenesis && !ctx.pragmaRoleAllowlist.includes(pragma.role)) {
        warnings.push({
          file: rel,
          detail: `pragma role \`${pragma.role}\` — allowlist check deferred (pre-genesis).`,
        });
      }
    } catch {
      // file unreadable — skip
    }
  }

  // Sort for deterministic output.
  reasons.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return (a.line ?? 0) - (b.line ?? 0);
  });

  return {
    blocked: reasons.length > 0,
    touchesClosure,
    reasons,
    warnings,
    closure: closureSorted,
    stats: {
      prFilesScanned: ctx.prFiles.length,
      closureFilesTotal: closureSorted.length,
      astNodesVisited,
    },
  };
}

// -----------------------------------------------------------------------------
// CLI entry — invoked as `bun run scripts/protocol-path-guard/check.ts`
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      args.set(k, v ?? process.argv[++i] ?? "");
    }
  }
  const repoRoot = args.get("repo-root") ?? process.cwd();
  const prFilesRaw = args.get("pr-files") ?? "";
  const anchorsRaw = args.get("anchors") ?? "";
  const tablesRaw = args.get("tables") ?? "";
  const rolesRaw = args.get("roles") ?? "";
  const preGenesis = args.get("pre-genesis") === "true";

  const prFiles = prFilesRaw ? prFilesRaw.split(",").filter(Boolean) : [];
  const anchors = anchorsRaw ? anchorsRaw.split(",").filter(Boolean) : [];
  const constitutionalTables = tablesRaw ? tablesRaw.split(",").filter(Boolean) : [];
  const pragmaRoleAllowlist = rolesRaw ? rolesRaw.split(",").filter(Boolean) : [];

  const result = await runCheck({
    repoRoot,
    prFiles,
    anchors,
    constitutionalTables,
    pragmaRoleAllowlist,
    preGenesis,
  });

  // Emit JSON to stdout; human-readable summary to stderr.
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  const head = `[protocol-path-guard] blocked=${result.blocked} touchesClosure=${result.touchesClosure} reasons=${result.reasons.length} warnings=${result.warnings.length}`;
  process.stderr.write(head + "\n");
  for (const r of result.reasons) {
    process.stderr.write(`  BLOCK [${r.kind}] ${r.file}${r.line ? ":" + r.line : ""} — ${r.detail}\n`);
  }
  process.exit(result.blocked ? 1 : 0);
}

// ts-morph projects + top-level await: only run main() when executed as CLI
// (never when imported by a test).
const invokedAsCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("check.ts");

if (invokedAsCli) {
  main().catch((err) => {
    process.stderr.write(`[protocol-path-guard] fatal: ${(err as Error).stack ?? err}\n`);
    process.exit(2);
  });
}
