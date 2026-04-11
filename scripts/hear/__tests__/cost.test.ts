import { describe, it, expect } from "bun:test";
import {
  CostMonitor,
  BudgetExceededError,
  hydrateCostMonitor,
} from "../lib/cost";

describe("CostMonitor.assertCanSpend", () => {
  it("passes when spend is under daily budget", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    expect(() => m.assertCanSpend(4.99)).not.toThrow();
  });

  it("throws BudgetExceededError when projected daily spend exceeds cap", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    m.record(4.50);
    expect(() => m.assertCanSpend(1.00)).toThrow(BudgetExceededError);
  });

  it("error has scope=daily when daily cap is the binding constraint", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    m.record(4.50);
    let caught: BudgetExceededError | null = null;
    try {
      m.assertCanSpend(1.00);
    } catch (err) {
      caught = err as BudgetExceededError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.scope).toBe("daily");
    expect(caught!.cap).toBe(5);
  });

  it("throws BudgetExceededError when projected monthly spend exceeds cap", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 50 });
    m.record(49.50);
    expect(() => m.assertCanSpend(1.00)).toThrow(BudgetExceededError);
  });

  it("error has scope=monthly when monthly cap is the binding constraint", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 50 });
    m.record(49.50);
    let caught: BudgetExceededError | null = null;
    try {
      m.assertCanSpend(1.00);
    } catch (err) {
      caught = err as BudgetExceededError;
    }
    expect(caught!.scope).toBe("monthly");
  });
});

describe("CostMonitor.record", () => {
  it("accumulates dailySpend, monthlySpend, and callCount", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    m.record(1.00);
    m.record(2.00);
    const snap = m.snapshot();
    expect(snap.dailySpend).toBe(3.00);
    expect(snap.monthlySpend).toBe(3.00);
    expect(snap.callCount).toBe(2);
  });
});

describe("hydrateCostMonitor", () => {
  it("sets initialDailySpend and initialMonthlySpend from DB queries", async () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes("date_trunc('day'")) {
          return { rows: [{ sum: "3.50" }] };
        }
        return { rows: [{ sum: "22.00" }] };
      },
    };
    await hydrateCostMonitor(m, mockPool);
    const snap = m.snapshot();
    expect(snap.dailySpend).toBeCloseTo(3.50);
    expect(snap.monthlySpend).toBeCloseTo(22.00);
    expect(snap.callCount).toBe(0);
  });

  it("handles NULL sums (empty judge_runs) without crashing", async () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    const mockPool = {
      query: async () => ({ rows: [{ sum: null }] }),
    };
    await hydrateCostMonitor(m, mockPool);
    const snap = m.snapshot();
    expect(snap.dailySpend).toBe(0);
    expect(snap.monthlySpend).toBe(0);
  });
});
