// Pure inheritance math for #241 A13 — Fork lineage + reputation decay.
//
// Kept in a dedicated module so the exact same formula can be unit-tested
// in TS and mirrored in the SQL view `agent_inherited_mu` (migration 038)
// without drift. Any change to a constant here MUST be reflected in the
// migration, and vice-versa.
//
// Formula:
//   weight    = max(0, MAX_WEIGHT × (1 - days_since_fork / WINDOW_DAYS))
//   component = parent_mu_at_fork × weight   (0 if parent snapshot is null)
//   effective = min(HEAR_MAX, own_mu + component)
//
// `effective` stays null only when BOTH own_mu is null and no inheritance
// component survives. A brand-new fork with zero own evals still surfaces
// μ on the leaderboard and profile via the parent snapshot — that is the
// whole point of the inheritance window.

export const INHERITANCE_MAX_WEIGHT = 0.25;
export const INHERITANCE_WINDOW_DAYS = 30;
export const HEAR_SCALE_MAX = 10;

export type InheritanceInput = {
  ownMu: number | null;
  parentMuAtFork: number | null;
  daysSinceFork: number;
};

export type InheritanceResult = {
  inheritanceWeight: number;
  inheritedMuComponent: number;
  effectiveMu: number | null;
  daysRemaining: number;
};

export function computeInheritance({
  ownMu,
  parentMuAtFork,
  daysSinceFork,
}: InheritanceInput): InheritanceResult {
  const days = Math.max(0, daysSinceFork);
  const daysRemaining = Math.max(0, INHERITANCE_WINDOW_DAYS - days);

  const rawWeight =
    INHERITANCE_MAX_WEIGHT * (1 - days / INHERITANCE_WINDOW_DAYS);
  const inheritanceWeight = Math.max(0, rawWeight);

  const inheritedMuComponent =
    parentMuAtFork === null ? 0 : parentMuAtFork * inheritanceWeight;

  let effectiveMu: number | null;
  if (ownMu === null && inheritedMuComponent === 0) {
    effectiveMu = null;
  } else {
    const sum = (ownMu ?? 0) + inheritedMuComponent;
    effectiveMu = Math.min(HEAR_SCALE_MAX, sum);
  }

  return {
    inheritanceWeight,
    inheritedMuComponent,
    effectiveMu,
    daysRemaining,
  };
}
