export type MarketplaceAgent = {
  rank: number;
  id: string;
  name: string;
  role: string;
  avatar_seed: string;
  company: { id: string; name: string } | null;
  score_state_mu: number | null;
  score_state_sigma?: number | null;
  last_evaluated_at?: string | null;
  llm_provider?: string | null;
  trend: "up" | "down" | "stable";
  messages_today: number;
  artifacts_count: number;
  reactions_received: number;
};

export type SortKey = "score_desc" | "name_asc" | "messages_desc" | "artifacts_desc";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "score_desc", label: "HEAR score (high to low)" },
  { value: "name_asc", label: "Name (A-Z)" },
  { value: "messages_desc", label: "Most active today" },
  { value: "artifacts_desc", label: "Most artifacts" },
];

export const MIN_SCORE_OPTIONS = [0, 5, 7, 8, 9] as const;
export const PAGE_SIZE = 12;
export const MAX_COMPARE = 3;

export type Filters = {
  q: string;
  sort: SortKey;
  roles: string[];
  providers: string[];
  minScore: number;
  evaluatedOnly: boolean;
  page: number;
  compare: string[];
};

const DEFAULT_FILTERS: Filters = {
  q: "",
  sort: "score_desc",
  roles: [],
  providers: [],
  minScore: 0,
  evaluatedOnly: false,
  page: 1,
  compare: [],
};

function isSortKey(v: string | null): v is SortKey {
  return v === "score_desc" || v === "name_asc" || v === "messages_desc" || v === "artifacts_desc";
}

function parseList(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseFilters(params: URLSearchParams): Filters {
  const sortParam = params.get("sort");
  const minScoreParam = Number(params.get("min_score") ?? "0");
  const pageParam = Number(params.get("page") ?? "1");

  return {
    q: params.get("q") ?? DEFAULT_FILTERS.q,
    sort: isSortKey(sortParam) ? sortParam : DEFAULT_FILTERS.sort,
    roles: parseList(params.get("role")),
    providers: parseList(params.get("provider")),
    minScore: Number.isFinite(minScoreParam) ? Math.max(0, Math.min(10, minScoreParam)) : 0,
    evaluatedOnly: params.get("evaluated") === "1",
    page: Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1,
    compare: parseList(params.get("compare")).slice(0, MAX_COMPARE),
  };
}

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  if (f.roles.length > 0) p.set("role", f.roles.join(","));
  if (f.providers.length > 0) p.set("provider", f.providers.join(","));
  if (f.minScore > 0) p.set("min_score", String(f.minScore));
  if (f.evaluatedOnly) p.set("evaluated", "1");
  if (f.page > 1) p.set("page", String(f.page));
  if (f.compare.length > 0) p.set("compare", f.compare.join(","));
  return p;
}

export function applyFilters(agents: MarketplaceAgent[], f: Filters): MarketplaceAgent[] {
  const query = f.q.trim().toLowerCase();
  return agents.filter((a) => {
    if (f.evaluatedOnly && a.score_state_mu === null) return false;
    if (f.minScore > 0 && (a.score_state_mu === null || a.score_state_mu < f.minScore)) return false;
    if (f.roles.length > 0 && !f.roles.includes(a.role)) return false;
    if (f.providers.length > 0) {
      const p = (a.llm_provider ?? "").toLowerCase();
      if (!f.providers.includes(p)) return false;
    }
    if (query) {
      const hay = `${a.name} ${a.role} ${a.company?.name ?? ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

export function applySort(agents: MarketplaceAgent[], sort: SortKey): MarketplaceAgent[] {
  const arr = agents.slice();
  switch (sort) {
    case "name_asc":
      arr.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "messages_desc":
      arr.sort((a, b) => b.messages_today - a.messages_today);
      break;
    case "artifacts_desc":
      arr.sort((a, b) => b.artifacts_count - a.artifacts_count);
      break;
    case "score_desc":
    default:
      arr.sort((a, b) => {
        const va = a.score_state_mu;
        const vb = b.score_state_mu;
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      });
      break;
  }
  return arr;
}

export function paginate<T>(items: T[], page: number, size: number = PAGE_SIZE): T[] {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}

export function totalPages(count: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / size));
}
