#!/usr/bin/env bash
# Creates the production secret files that do not exist yet (Task S2), following
# docs/operations/secrets.md. Existing files are NEVER replaced. Prints file names only, never
# values. Run as root from infra/production with the API image tag as the only argument.
#
# Differences from the manual procedure in secrets.md, because nobody works on the server by hand:
# - The database's private certificate authority is created here and its key is DELETED right
#   after signing, instead of being kept offline. To renew the certificate (every 825 days),
#   delete database_ca.crt, database_server.crt and database_server.key and run a release:
#   a new authority and certificate are made, and the services restart with them.
# - smtp_password and smtp_user are written by the Deploy workflow from GitHub secrets.
# - rclone.conf starts empty; the off-site copy is set up in task S6.
set -euo pipefail
api_image="${1:?Usage: make-secrets.sh <api-image>}"
cd secrets
umask 077

made() { echo "created secrets/$1"; }
random() { [ -s "$1" ] || { openssl rand -hex 32 > "$1"; made "$1"; }; }

random postgres_password
random app_db_password
random migrator_db_password
random backup_passphrase
random mfa_encryption_key

if [ ! -s database_url ]; then
  printf 'postgresql://constitution_app:%s@postgres:5432/constitution' "$(cat app_db_password)" > database_url
  made database_url
fi
if [ ! -s database_migrator_url ]; then
  printf 'postgresql://constitution_migrator:%s@postgres:5432/constitution' "$(cat migrator_db_password)" > database_migrator_url
  made database_migrator_url
fi

if [ ! -s database_ca.crt ] || [ ! -s database_server.crt ] || [ ! -s database_server.key ]; then
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj "/CN=Constitution DB CA" \
    -keyout "$work/ca.key" -out database_ca.crt 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=postgres" \
    -keyout database_server.key -out "$work/server.csr" 2>/dev/null
  printf 'subjectAltName=DNS:postgres\n' > "$work/san.ext"
  openssl x509 -req -in "$work/server.csr" -CA database_ca.crt -CAkey "$work/ca.key" \
    -CAcreateserial -CAserial "$work/ca.srl" -days 825 -extfile "$work/san.ext" \
    -out database_server.crt 2>/dev/null
  rm -rf "$work"
  trap - EXIT
  chmod 0644 database_ca.crt database_server.crt
  made "database certificate (authority key deleted)"
fi
# The database runs as user 999 inside its container and must read its key.
chown root:999 database_server.key
chmod 0640 database_server.key

if [ ! -s audit_seal_key ]; then
  docker run --rm --entrypoint node "$api_image" dist/cli/audit-seal.js --generate-key > audit_seal_key.new
  grep -q 'BEGIN PRIVATE KEY' audit_seal_key.new
  mv audit_seal_key.new audit_seal_key
  made audit_seal_key
fi

[ -e rclone.conf ] || { : > rclone.conf; made "rclone.conf (empty until task S6)"; }

# Protection on the server comes from the FOLDER: only root may enter it (0700). The files
# themselves must stay readable (0644) because Compose mounts each one into its container as-is,
# where the application runs as an unprivileged user ("node") that could not read a 0600 root file.
# (The deployment check uses the same layout.) The database key is the exception (root:999, 0640).
chown root:root . && chmod 0700 .
for file in postgres_password app_db_password migrator_db_password backup_passphrase \
  mfa_encryption_key database_url database_migrator_url audit_seal_key rclone.conf \
  smtp_password smtp_user; do
  if [ -e "$file" ]; then chown root:root "$file"; chmod 0644 "$file"; fi
done
# The responders' addresses are read only by the watchdog on the server, as root.
if [ -e alert_recipients ]; then chown root:root alert_recipients; chmod 0600 alert_recipients; fi
echo "Secrets checked."
