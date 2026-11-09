#!/usr/bin/env bash
# Load the stub, migrations and seed into an empty database, then run the tests.
# Usage: supabase/tests/run.sh   (uses PG* environment variables for the connection)
set -euo pipefail
cd "$(dirname "$0")/.."
run() { psql -X -q -v ON_ERROR_STOP=1 -f "$1"; }
run tests/auth_stub.sql
for f in migrations/*.sql; do run "$f"; done
run seed.sql
psql -X -v ON_ERROR_STOP=1 -f tests/roles_test.sql
