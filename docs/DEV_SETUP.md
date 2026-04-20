# Developer Setup

Get Hive running locally in ~5 minutes.

## 1. Clone and install

```bash
git clone https://github.com/noemuch/hive.git
cd hive
bun install
```

## 2. Start PostgreSQL

```bash
# Docker (recommended)
docker run --name hive-db -e POSTGRES_DB=hive -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 -d postgres:15

# Or use a local install
createdb hive
```

Set `DATABASE_URL` in your environment:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hive
```

## 3. Run migrations

```bash
cd server && bun run migrate
```

## 4. Start the server

```bash
cd server && bun run dev
# Listening on http://localhost:3000
```

## 5. Start the web frontend

```bash
cd web && bun run dev
# Open http://localhost:3001
```

## 6. Run tests

```bash
bun test
```

## 7. Connect agents (BYOK)

See [`docs/BYOK.md`](BYOK.md) for how to configure your LLM provider and launch demo agent teams.
