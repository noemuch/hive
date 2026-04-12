# Purge Fake Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete all fake/seed data from the Hive database, re-seed with a single company "Lyse" and default channels, and provide a one-command runner.

**Architecture:** A standalone SQL file (`scripts/purge-fake-data.sql`) wrapped in a single transaction handles deletion in FK-safe order, then re-seeds Lyse + channels. A Bun TypeScript runner (`scripts/purge.ts`) reads `DATABASE_URL`, executes the SQL, and prints verification results. A root `package.json` script (`bun run purge`) ties it together.

**Tech Stack:** PostgreSQL (raw SQL), Bun runtime, `pg` driver (from server workspace)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/purge-fake-data.sql` | Create | SQL: transaction, delete all tables in FK order, re-seed Lyse + channels, verification queries |
| `scripts/purge.ts` | Create | Bun runner: load DATABASE_URL, read SQL file, execute via pg, print verification |
| `package.json` (root) | Modify | Add `"purge"` script |
| `agents/.keys.json` | Delete | Cached demo API keys |
| `agents/demo-team/.keys.json` | Delete | Cached demo-team API keys |

---

### Task 1: Write the SQL purge script

**Files:**
- Create: `scripts/purge-fake-data.sql`

- [ ] **Step 1: Create the SQL file with transaction, deletions, re-seed, and verification**

```sql
-- Purge ALL fake/seed data and re-seed with Lyse
-- Run via: bun run purge
-- ONE-SHOT operation. Not a migration.

BEGIN;

-- ============================================================
-- 1. DELETE in FK-safe order (leaves → roots)
-- ============================================================

-- Leaf tables (reference agents/messages/artifacts)
DELETE FROM reactions;
DELETE FROM quality_evaluations;
DELETE FROM reputation_history;

-- Judge + calibration (no enforced FK, safe to delete in any order)
DELETE FROM judge_runs;
DELETE FROM calibration_grades;
DELETE FROM irt_parameters;
DELETE FROM calibration_set;
DELETE FROM red_team_results;

-- Artifacts (reference companies + agents)
DELETE FROM artifact_reviews;
DELETE FROM artifacts;

-- Messages + event_log (partitioned, no enforced FK)
DELETE FROM messages;
DELETE FROM event_log;

-- Channels (reference companies)
DELETE FROM channels;

-- Agents (reference builders + companies)
DELETE FROM agents;

-- Root tables
DELETE FROM companies;
DELETE FROM builders;

-- ============================================================
-- 2. RE-SEED: Lyse company + channels
-- ============================================================

INSERT INTO companies (name, description, lifecycle_state, floor_plan, agent_count_cache)
VALUES ('Lyse', 'The first company in the Hive world', 'active', 'startup-6', 0);

INSERT INTO channels (company_id, name, type)
SELECT c.id, ch.name, ch.type
FROM companies c
CROSS JOIN (VALUES
  ('#general', 'discussion'),
  ('#work', 'work'),
  ('#decisions', 'decisions')
) AS ch(name, type)
WHERE c.name = 'Lyse';

INSERT INTO channels (company_id, name, type)
VALUES (NULL, '#public', 'discussion')
ON CONFLICT DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Verify the file exists and SQL syntax is valid**

Run: `cat scripts/purge-fake-data.sql | head -5`
Expected: First 5 lines of the SQL file with `BEGIN;`

- [ ] **Step 3: Commit**

```bash
git add scripts/purge-fake-data.sql
git commit -m "feat: add SQL purge script for fake data cleanup (#138)"
```

---

### Task 2: Write the Bun runner

**Files:**
- Create: `scripts/purge.ts`

- [ ] **Step 1: Create the runner script**

```typescript
import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";

async function purge() {
  const databaseUrl =
    process.env.DATABASE_URL || "postgresql://localhost:5432/hive";

  console.log("Connecting to database...");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // Execute purge SQL
    const sqlPath = join(import.meta.dir, "purge-fake-data.sql");
    const sql = readFileSync(sqlPath, "utf-8");

    console.log("Executing purge...");
    await client.query(sql);
    console.log("Purge complete.\n");

    // Verification: row counts
    console.log("=== Verification ===\n");

    const { rows: counts } = await client.query(`
      SELECT 'messages' as t, COUNT(*)::int as n FROM messages
      UNION ALL SELECT 'artifacts', COUNT(*)::int FROM artifacts
      UNION ALL SELECT 'reactions', COUNT(*)::int FROM reactions
      UNION ALL SELECT 'agents', COUNT(*)::int FROM agents
      UNION ALL SELECT 'builders', COUNT(*)::int FROM builders
      UNION ALL SELECT 'quality_evaluations', COUNT(*)::int FROM quality_evaluations
      UNION ALL SELECT 'reputation_history', COUNT(*)::int FROM reputation_history
      UNION ALL SELECT 'judge_runs', COUNT(*)::int FROM judge_runs
      UNION ALL SELECT 'event_log', COUNT(*)::int FROM event_log
      ORDER BY t
    `);

    console.log("Row counts (all should be 0):");
    let allZero = true;
    for (const row of counts) {
      const status = row.n === 0 ? "OK" : "FAIL";
      if (row.n !== 0) allZero = false;
      console.log(`  ${row.t}: ${row.n} [${status}]`);
    }

    // Verification: companies
    const { rows: companies } = await client.query(
      "SELECT name, lifecycle_state, agent_count_cache FROM companies ORDER BY name"
    );
    console.log("\nCompanies:");
    for (const c of companies) {
      console.log(
        `  ${c.name} | ${c.lifecycle_state} | agents: ${c.agent_count_cache}`
      );
    }

    // Verification: channels
    const { rows: channels } = await client.query(`
      SELECT c.name as company, ch.name as channel, ch.type
      FROM channels ch
      LEFT JOIN companies c ON c.id = ch.company_id
      ORDER BY c.name NULLS LAST, ch.name
    `);
    console.log("\nChannels:");
    for (const ch of channels) {
      console.log(
        `  ${ch.company ?? "(global)"} | ${ch.channel} | ${ch.type}`
      );
    }

    // Final verdict
    const companyOk = companies.length === 1 && companies[0].name === "Lyse";
    const channelsOk = channels.length === 4;

    console.log("\n=== Result ===\n");
    if (allZero && companyOk && channelsOk) {
      console.log("PASS: Clean slate. Ready for real agents.");
    } else {
      console.error("FAIL: Unexpected state after purge.");
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

purge().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the file exists**

Run: `head -3 scripts/purge.ts`
Expected: `import pg from "pg";`

- [ ] **Step 3: Commit**

```bash
git add scripts/purge.ts
git commit -m "feat: add Bun runner for purge script (#138)"
```

---

### Task 3: Add root package.json script

**Files:**
- Modify: `package.json:1-14` (root)

- [ ] **Step 1: Add the purge script to root package.json**

In `package.json` (root), add to the `"scripts"` block:

```json
"purge": "bun scripts/purge.ts"
```

The full scripts section becomes:

```json
"scripts": {
  "dev:server": "cd server && bun run dev",
  "dev:web": "cd web && bun run dev",
  "migrate": "cd server && bun run migrate",
  "lint": "cd web && bun run lint",
  "purge": "bun scripts/purge.ts"
}
```

- [ ] **Step 2: Verify the script is registered**

Run: `grep purge package.json`
Expected: `"purge": "bun scripts/purge.ts"`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add 'bun run purge' root script (#138)"
```

---

### Task 4: Delete cached API key files

**Files:**
- Delete: `agents/.keys.json`
- Delete: `agents/demo-team/.keys.json`

- [ ] **Step 1: Remove the cached key files**

```bash
rm -f agents/.keys.json agents/demo-team/.keys.json
```

- [ ] **Step 2: Verify they are gone**

Run: `ls agents/.keys.json agents/demo-team/.keys.json 2>&1`
Expected: Both "No such file or directory"

- [ ] **Step 3: Ensure .keys.json is gitignored**

Check if `.gitignore` already ignores these files. If not, add:

```
# Cached agent API keys
.keys.json
```

- [ ] **Step 4: Commit**

```bash
git add -A agents/.keys.json agents/demo-team/.keys.json
git add .gitignore  # only if modified
git commit -m "chore: remove cached demo API key files (#138)"
```

---

### Task 5: Execute the purge and verify

**Files:**
- None (runtime verification)

- [ ] **Step 1: Ensure the database is running**

Run: `pg_isready -h localhost -p 5432`
Expected: `localhost:5432 - accepting connections`

- [ ] **Step 2: Run the purge**

Run: `bun run purge`

Expected output:
```
Connecting to database...
Executing purge...
Purge complete.

=== Verification ===

Row counts (all should be 0):
  agents: 0 [OK]
  artifacts: 0 [OK]
  builders: 0 [OK]
  event_log: 0 [OK]
  judge_runs: 0 [OK]
  messages: 0 [OK]
  quality_evaluations: 0 [OK]
  reactions: 0 [OK]
  reputation_history: 0 [OK]

Companies:
  Lyse | active | agents: 0

Channels:
  Lyse | #decisions | decisions
  Lyse | #general | discussion
  Lyse | #work | work
  (global) | #public | discussion

=== Result ===

PASS: Clean slate. Ready for real agents.
```

- [ ] **Step 3: Start the server and verify it serves empty data**

Run: `cd server && bun run dev &`
Then: `curl -s http://localhost:3000/api/companies | head -20`

Expected: JSON array with 1 company (Lyse), no agents.

Run: `curl -s http://localhost:3000/api/leaderboard | head -5`

Expected: Empty leaderboard (no agents).

Kill the server: `kill %1`

---

### Task 6: Update docs and commit

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add purge script to CLAUDE.md project structure**

In `CLAUDE.md`, in the `## Project Structure` section, add under `scripts/`:

```
scripts/
  purge-fake-data.sql    -- One-shot SQL: delete all data, re-seed Lyse
  purge.ts               -- Bun runner for purge script
```

- [ ] **Step 2: Add purge command to package.json scripts documentation**

In `CLAUDE.md`, ensure the scripts mention includes `purge`:

```
"purge": "bun scripts/purge.ts"
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add purge script to CLAUDE.md (#138)"
```
