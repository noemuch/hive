/**
 * HEAR Judge Service — In-process cost monitor with hard caps.
 *
 * The judge service spends real money on Anthropic API calls (V1: indirectly,
 * via the user's Claude Max subscription routed through `claude -p`). To
 * prevent a runaway batch from blowing the budget, this module:
 *
 *   - Tracks cost per call as the batch progresses
 *   - Enforces a daily cap (default $5)
 *   - Enforces a monthly cap (default $50, naive — V2 will read judge_runs)
 *   - Throws BudgetExceededError when a planned call would exceed either cap
 *
 * The caller catches BudgetExceededError, halts the batch, and exits cleanly.
 *
 * V1 limitation: monthly tracking is in-process only and does NOT consult the
 * judge_runs table. A second invocation on the same day starts with the same
 * monthly counter as the first. V2 will hydrate the monthly counter from
 *   SELECT SUM(cost_usd) FROM judge_runs WHERE created_at >= date_trunc('month', now())
 * before starting the batch.
 */

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly scope: "daily" | "monthly",
    public readonly spent: number,
    public readonly cap: number,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export type CostMonitorOptions = {
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  /** Optional warm-start so the monitor knows about prior calls today/this month. */
  initialDailySpend?: number;
  initialMonthlySpend?: number;
};

export class CostMonitor {
  private dailySpend: number;
  private monthlySpend: number;
  private callCount = 0;

  constructor(private opts: CostMonitorOptions) {
    this.dailySpend = opts.initialDailySpend ?? 0;
    this.monthlySpend = opts.initialMonthlySpend ?? 0;
  }

  /**
   * Check whether we have headroom for at least one more call of the
   * given expected cost. Use a conservative estimate so that the actual
   * cost coming back from the CLI doesn't unexpectedly tip us over.
   */
  assertCanSpend(expectedCostUsd: number): void {
    const projectedDaily = this.dailySpend + expectedCostUsd;
    if (projectedDaily > this.opts.dailyBudgetUsd) {
      throw new BudgetExceededError(
        `daily budget exceeded: $${projectedDaily.toFixed(4)} > $${this.opts.dailyBudgetUsd.toFixed(2)}`,
        "daily",
        this.dailySpend,
        this.opts.dailyBudgetUsd,
      );
    }
    const projectedMonthly = this.monthlySpend + expectedCostUsd;
    if (projectedMonthly > this.opts.monthlyBudgetUsd) {
      throw new BudgetExceededError(
        `monthly budget exceeded: $${projectedMonthly.toFixed(4)} > $${this.opts.monthlyBudgetUsd.toFixed(2)}`,
        "monthly",
        this.monthlySpend,
        this.opts.monthlyBudgetUsd,
      );
    }
  }

  /**
   * Record an actual cost AFTER a call has completed. If the call was
   * unexpectedly expensive and we are now over budget, the next call's
   * `assertCanSpend` will reject — we don't retroactively rollback.
   */
  record(actualCostUsd: number): void {
    this.dailySpend += actualCostUsd;
    this.monthlySpend += actualCostUsd;
    this.callCount += 1;
  }

  snapshot(): {
    dailySpend: number;
    monthlySpend: number;
    dailyBudget: number;
    monthlyBudget: number;
    callCount: number;
  } {
    return {
      dailySpend: this.dailySpend,
      monthlySpend: this.monthlySpend,
      dailyBudget: this.opts.dailyBudgetUsd,
      monthlyBudget: this.opts.monthlyBudgetUsd,
      callCount: this.callCount,
    };
  }
}

/**
 * Build a CostMonitor from environment variables. Defaults: $5/day, $50/month.
 */
export function costMonitorFromEnv(): CostMonitor {
  return new CostMonitor({
    dailyBudgetUsd: Number(process.env.HEAR_JUDGE_DAILY_BUDGET ?? "5"),
    monthlyBudgetUsd: Number(process.env.HEAR_JUDGE_MONTHLY_BUDGET ?? "50"),
  });
}

/**
 * Conservative pre-flight estimate for a single Opus axis call.
 * Tuned to err on the high side so we don't sail past the cap. The actual
 * cost reported by `claude -p --output-format json` is recorded after the call.
 */
export const ESTIMATED_COST_PER_CALL_USD = 0.05;
