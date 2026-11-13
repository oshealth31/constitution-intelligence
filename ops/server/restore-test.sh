#!/usr/bin/env bash
# Restore test on the real server (Task S7): proves that tonight's off-site backup can bring
# the platform back. Run as root by the Deploy workflow (task: restore-test).
#
#  1. download the newest backup from the OFF-SITE copy into an empty folder, check checksums
#  2. restore it into a NEW database (constitution_restore_test) and a NEW storage volume
#     (ops/restore.sh refuses anything that is not empty; the live data is never touched)
#  3. compare: every table present, row counts against the live database, files byte-identical
#  4. the security rules survived: audit log append-only, row-level security isolates
#     organisations
#  5. the application starts on the restored copy and reports the database ready
#  6. remove the test database, volume and download; print how long it took
#
# Output: counts and results only, never personal data.
set -uo pipefail
prod=/srv/constitution/infra/production
cd "$prod" || exit 1
started=$(date +%s)
test_db=constitution_restore_test
volume=constitution-restore-test-storage
work="$(mktemp -d /tmp/restore-test.XXXXXX)"
api_container=constitution-restore-test-api
status=0
fail() { echo "FAIL: $*"; status=1; }

admin() { docker compose exec -T postgres psql -U constitution_owner -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  docker rm -f "$api_container" > /dev/null 2>&1
  admin -d constitution -qc "DROP DATABASE IF EXISTS $test_db" > /dev/null 2>&1
  docker volume rm "$volume" > /dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT
cleanup_before() { admin -d constitution -qc "DROP DATABASE IF EXISTS $test_db" > /dev/null 2>&1; docker volume rm "$volume" > /dev/null 2>&1; }
cleanup_before
ops_image="$(sed -n 's/^OPS_IMAGE=//p' .env)"
api_image="$(sed -n 's/^API_IMAGE=//p' .env)"
network="$(docker network ls --format '{{.Name}}' | grep -E '_data$' | head -n 1)"

echo "== 1. Download the newest backup from off-site"
newest="$(docker compose --profile ops run --rm -T ops /ops/offsite-fetch.sh | grep -E '^20[0-9]{6}T[0-9]{6}Z$' | tail -n 1)"
[ -n "$newest" ] || { echo "FAIL: no backup found off-site"; exit 1; }
echo "newest off-site backup: $newest"
chmod 0777 "$work"
docker compose --profile ops run --rm -T -v "$work:/fetch" -e BACKUP_DIR=/fetch ops \
  /ops/offsite-fetch.sh "$newest" || { echo "FAIL: download or checksum failed"; exit 1; }

echo "== 2. Restore into a new database and new storage"
admin -d constitution -qc "CREATE DATABASE $test_db OWNER constitution_migrator"
admin -d "$test_db" -qc 'CREATE EXTENSION IF NOT EXISTS pg_trgm' -qc 'CREATE EXTENSION IF NOT EXISTS vector' \
  -qc 'ALTER SCHEMA public OWNER TO constitution_migrator'
docker volume create "$volume" > /dev/null
migrator_password="$(cat secrets/migrator_db_password)"
printf 'postgresql://constitution_migrator:%s@postgres:5432/%s' "$migrator_password" "$test_db" > "$work/target_url"
chmod 0644 "$work/target_url"
docker run --rm --network "$network" \
  -v "$work:/fetch:ro" -v "$prod/secrets:/s:ro" -v "$volume:/restored" \
  -e TARGET_DATABASE_URL_FILE=/fetch/target_url -e TARGET_STORAGE_DIR=/restored \
  -e BACKUP_PASSPHRASE_FILE=/s/backup_passphrase \
  -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/s/database_ca.crt \
  "$ops_image" /ops/restore.sh "/fetch/$newest" || { echo "FAIL: restore failed"; exit 1; }

echo "== 3. Compare with the live database"
count_rows() { # database -> "table count" lines
  admin -d "$1" -Atc "SELECT format('%s %s', relname, n) FROM (
    SELECT c.relname, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', c.relname), false, true, '')))[1]::text::bigint AS n
    FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname) t"
}
count_rows constitution > "$work/live.txt"
count_rows "$test_db" > "$work/restored.txt"
live_tables=$(wc -l < "$work/live.txt"); restored_tables=$(wc -l < "$work/restored.txt")
echo "tables: live $live_tables, restored $restored_tables"
[ "$live_tables" = "$restored_tables" ] || fail "the restored copy has a different number of tables"
printf '%-34s %10s %10s\n' TABLE LIVE RESTORED
join "$work/live.txt" "$work/restored.txt" | while read -r table live restored; do
  note=""
  [ "$live" = "$restored" ] || note="(changed since the backup)"
  printf '%-34s %10s %10s %s\n' "$table" "$live" "$restored" "$note"
done
# Rows that only grow slowly must match exactly; logs and sessions may have grown since.
for table in organisations users memberships constitutions constitution_versions sections files; do
  live=$(awk -v t="$table" '$1 == t {print $2}' "$work/live.txt")
  restored=$(awk -v t="$table" '$1 == t {print $2}' "$work/restored.txt")
  [ -z "$live" ] || [ "$live" = "$restored" ] || fail "$table: live $live, restored $restored"
done
sums() { docker run --rm -v "$1:/d:ro" "$ops_image" bash -c 'cd /d && find . -type f -exec sha256sum {} + | sort -k2'; }
storage_volume="$(docker volume ls --format '{{.Name}}' | grep -E '_storage$' | head -n 1)"
sums "$storage_volume" > "$work/original.sha"
sums "$volume" > "$work/restored.sha"
if diff -q "$work/original.sha" "$work/restored.sha" > /dev/null; then
  echo "files: $(wc -l < "$work/restored.sha") identical (SHA-256)"
else
  echo "files: live $(wc -l < "$work/original.sha"), restored $(wc -l < "$work/restored.sha") (files added since the backup are expected)"
  missing=$(comm -13 <(sort "$work/original.sha") <(sort "$work/restored.sha") | wc -l)
  [ "$missing" = 0 ] || fail "$missing restored file(s) differ from the live ones"
fi

echo "== 4. Security rules"
tamper="$(admin -d "$test_db" -Atc "UPDATE audit_events SET action = 'tampered'" 2>&1 || true)"
if grep -q 'append-only' <<<"$tamper"; then echo "ok: audit log is still append-only"; else fail "the audit log could be changed"; fi
orgs=$(admin -d "$test_db" -Atc "SELECT count(*) FROM organisations")
first_org=$(admin -d "$test_db" -Atc "SELECT id FROM organisations ORDER BY created_at LIMIT 1")
if [ -n "$first_org" ]; then
  visible="$(admin -d "$test_db" -Atq -c 'BEGIN' -c 'SET LOCAL ROLE app_tenant' \
    -c "SELECT set_config('app.current_organisation_id', '$first_org', true)" \
    -c 'SELECT count(*) FROM organisations' -c 'COMMIT' | sed -n 2p)"
  if [ "$visible" = 1 ]; then echo "ok: row-level security shows 1 of $orgs organisation(s)"; else fail "row-level security shows $visible organisations"; fi
else
  echo "no organisations yet: row-level security not checked on data"
fi

echo "== 5. The application on the restored copy"
app_password="$(cat secrets/app_db_password)"
printf 'postgresql://constitution_app:%s@postgres:5432/%s' "$app_password" "$test_db" > "$work/app_url"
chmod 0644 "$work/app_url"
docker run -d --name "$api_container" --network "$network" --env-file api.env \
  -e DATABASE_URL_FILE=/fetch/app_url -e NODE_EXTRA_CA_CERTS=/s/database_ca.crt \
  -e SMTP_PASSWORD_FILE=/s/smtp_password -e MFA_ENCRYPTION_KEY_FILE=/s/mfa_encryption_key \
  -e AUDIT_SEAL_KEY_FILE=/s/audit_seal_key \
  -v "$work:/fetch:ro" -v "$prod/secrets:/s:ro" -v "$volume:/var/lib/constitution/storage" \
  "$api_image" > /dev/null
ready=0
for _ in $(seq 1 30); do
  if docker exec "$api_container" node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ready=1; break; fi
  sleep 2
done
if [ "$ready" = 1 ]; then echo "ok: the API started on the restored copy and its database is ready"; else fail "the API did not become ready on the restored copy"; docker logs --tail 20 "$api_container" 2>&1 | grep -v '@'; fi

echo "== 6. Result"
took=$(( $(date +%s) - started ))
echo "backup restored: $newest (from the off-site copy)"
echo "time taken: $((took / 60)) min $((took % 60)) s"
if [ "$status" = 0 ]; then echo "RESTORE TEST PASSED"; else echo "RESTORE TEST FAILED"; fi
exit "$status"
