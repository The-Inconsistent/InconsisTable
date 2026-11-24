#!/bin/bash
# Every gate of this checkout, one short line each, for the cheaper model that runs them (.claude/agents/plan-executor.md).
# Usage: scripts/gates.sh [port]   (default 4051; two throwaway databases named after the port are made and dropped)
# Needs the dev Postgres container (inconsistable-pg on localhost:5435) and Go on PATH.
cd "$(dirname "$0")/.." || exit 2
PORT="${1:-4051}"; LOG="$(mktemp -d)"; DB="postgres://it:it@localhost:5435"
echo "branch $(git branch --show-current) at $(git rev-parse --short HEAD); uncommitted files: $(git status --short | wc -l | tr -d ' ')"
q() { docker exec inconsistable-pg psql -U it -d it -At "$@" >/dev/null 2>&1; }
q -c "DROP DATABASE IF EXISTS gates_go_$PORT" -c "CREATE DATABASE gates_go_$PORT" -c "DROP DATABASE IF EXISTS gates_smoke_$PORT" -c "CREATE DATABASE gates_smoke_$PORT"
BAD=0
run() { name="$1"; shift; if "$@" >"$LOG/$name.log" 2>&1; then echo "$name: ok"; else echo "$name: FAIL"; tail -25 "$LOG/$name.log"; BAD=1; fi; }
run typecheck bun run typecheck
run lint bun run lint
run format bun run format:check
run unit bun run test; echo "  unit: $(grep -E '^ *[0-9]+ (pass|fail)' "$LOG/unit.log" | tr -s ' ' | tr '\n' ' ')"
TEST_DATABASE_URL="$DB/gates_go_$PORT" run go bun run test:go
echo "  go: $(grep -cE '^ok' "$LOG/go.log") packages ok; failures: $(grep -cE '^(FAIL|--- FAIL|panic)' "$LOG/go.log")"; grep -E '^(FAIL|--- FAIL|panic)' "$LOG/go.log" | head -8
if (cd apps/api-go && go vet ./... >"$LOG/vet.log" 2>&1); then echo "vet: ok"; else echo "vet: FAIL"; tail -15 "$LOG/vet.log"; BAD=1; fi
F=$(cd apps/api-go && gofmt -l . | head -5); if [ -z "$F" ]; then echo "gofmt: ok"; else echo "gofmt: FAIL $F"; BAD=1; fi
KEY=$(openssl rand -hex 24)
(cd apps/api-go && DATABASE_URL="$DB/gates_smoke_$PORT" ADMIN_KEY=$KEY WEB_ORIGIN=http://localhost:3000 PORT=$PORT NODE_ENV=test TRUST_CF=1 nohup go run ./cmd/api >"$LOG/api.log" 2>&1 &)
for _ in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null | grep -q 200 && break; sleep 1; done
API_URL="http://localhost:$PORT" ADMIN_KEY=$KEY DATABASE_URL="$DB/gates_smoke_$PORT" bun run test:smoke >"$LOG/smoke.log" 2>&1 || BAD=1
echo "smoke: $(grep -E ' pass$| fail$' "$LOG/smoke.log" | sed 's/.*test:smoke: *//' | tr '\n' ' ')"
grep -E '\(fail\)' "$LOG/smoke.log" | sed 's/.*test:smoke: *//' | head -8; grep -n "AssertionError" -A6 "$LOG/smoke.log" | sed 's/.*test:smoke: *//' | head -30
lsof -ti "tcp:$PORT" | xargs kill 2>/dev/null; sleep 1
q -c "DROP DATABASE IF EXISTS gates_go_$PORT" -c "DROP DATABASE IF EXISTS gates_smoke_$PORT"
rm -rf "$LOG"
if [ "$BAD" = 0 ]; then echo "done: every gate passed"; else echo "done: AT LEAST ONE GATE FAILED"; exit 1; fi
