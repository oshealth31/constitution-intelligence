#!/usr/bin/env bash
# Installs or upgrades Constitution Intelligence on the prepared server (Task S2).
# Called by the "Deploy" workflow (task: release) after it has copied infra/production, ops and
# deploy to /srv/constitution and loaded the images constitution-{api,web,ops}:<version>.
# Run as root:  release.sh <version>
#
# Steps (docs/operations/deployment.md, sections 2-6):
#  1. create missing secret files (never replaces existing ones)
#  2. write .env and api.env from deploy/production.env (the previous ones are kept as *.previous)
#  3. back up the database first, if one already exists
#  4. start the database, apply migrations, start the application and HTTPS
#  5. install the watchdog timer (Task S5)
#  6. install the nightly backup and audit-seal timers once off-site copies are set up (S6)
#  7. record the release in /srv/constitution/releases.log
# Output contains no secret values (the workflow's log is public).
set -euo pipefail
version="${1:?Usage: release.sh <version>}"
root=/srv/constitution
prod="$root/infra/production"
cd "$prod"

api_image="constitution-api:$version"
web_image="constitution-web:$version"
ops_image="constitution-ops:$version"
for image in "$api_image" "$web_image" "$ops_image"; do
  docker image inspect "$image" >/dev/null 2>&1 || { echo "Image $image is not loaded." >&2; exit 1; }
done

echo "== 1. Secrets"
install -d -m 0700 secrets
bash "$root/ops/server/make-secrets.sh" "$api_image"
if [ ! -s secrets/smtp_password ] || [ ! -s secrets/smtp_user ]; then
  echo "The email (SMTP) key or login is missing. Add the GitHub secrets SMTP_KEY and SMTP_LOGIN" >&2
  echo "(docs/operations/oracle-cloud.md), then run the release again." >&2
  exit 1
fi

echo "== 2. Settings"
# Read the committed, non-secret settings without running them as shell code.
setting() { sed -n "s/^$1=//p" "$root/deploy/production.env" | tail -n 1; }
site="$(setting SITE_ADDRESS)"
mail_from="$(setting MAIL_FROM)"
reply_to="$(setting MAIL_REPLY_TO)"
payment="$(setting BILLING_PAYMENT_INSTRUCTIONS)"
[[ "$site" =~ ^[a-z0-9.-]+$ ]] || { echo "SITE_ADDRESS is missing or invalid in deploy/production.env" >&2; exit 1; }
[ -n "$mail_from" ] || { echo "MAIL_FROM is missing in deploy/production.env" >&2; exit 1; }

# Off-site locations (Task S6): only used once secrets/rclone.conf holds the access key.
offsite_remote="" offsite_audit_remote=""
if [ -s secrets/rclone.conf ]; then
  offsite_remote="$(setting OFFSITE_REMOTE)"
  offsite_audit_remote="$(setting OFFSITE_AUDIT_REMOTE)"
fi
[ -f .env ] && cp -p .env .env.previous
cat > .env.new <<CONF
# Written by ops/server/release.sh for release $version. Change deploy/production.env instead.
SITE_ADDRESS=$site
API_IMAGE=$api_image
WEB_IMAGE=$web_image
OPS_IMAGE=$ops_image
OFFSITE_REMOTE=$offsite_remote
OFFSITE_AUDIT_REMOTE=$offsite_audit_remote
CONF
mv .env.new .env

[ -f api.env ] && cp -p api.env api.env.previous
{
  echo "# Written by ops/server/release.sh for release $version from api.env.example and"
  echo "# deploy/production.env. Change those (in a pull request) instead of this file."
  sed -e "s#^APP_VERSION=.*#APP_VERSION=$version#" \
      -e "s#^CORS_ORIGINS=.*#CORS_ORIGINS=https://$site#" \
      -e "s#^WEB_BASE_URL=.*#WEB_BASE_URL=https://$site#" \
      -e "/^SMTP_USER=/d" -e "/^MAIL_FROM=/d" -e "/^MAIL_REPLY_TO=/d" \
      -e "/^BILLING_PAYMENT_INSTRUCTIONS=/d" api.env.example | grep -v '^# =\|^$'
  echo "SMTP_USER=$(cat secrets/smtp_user)"
  echo "MAIL_FROM=$mail_from"
  if [ -n "$reply_to" ]; then echo "MAIL_REPLY_TO=$reply_to"; fi
  if [ -n "$payment" ]; then echo "BILLING_PAYMENT_INSTRUCTIONS=$payment"; fi
} > api.env.new
chmod 0644 api.env.new
mv api.env.new api.env
echo "Settings written for https://$site (version $version)."

echo "== 3. Backup before changes"
if docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  docker compose --profile ops run --rm -T ops /ops/backup.sh | tail -n 3
else
  echo "No running database yet: first installation, nothing to back up."
fi

echo "== 4. Start"
docker compose up -d --wait postgres
docker compose --profile migrate run --rm -T migrate
docker compose up -d --wait api web caddy
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

# Inside check (does not need DNS): the web app and the API through it.
docker compose exec -T web node -e "
  Promise.all(['/api/health','/api/v1/health/ready'].map(p=>fetch('http://127.0.0.1:3000'+p).then(r=>[p,r.status])))
    .then(rs=>{rs.forEach(([p,s])=>console.log((s===200?'ok   ':'FAIL ')+p+' '+s));process.exit(rs.every(([,s])=>s===200)?0:1)})
    .catch(e=>{console.error('FAIL',e.message);process.exit(1)})"

echo "== 5. Watchdog (Task S5)"
# Checks the platform every 10 minutes and emails the responders (secrets/alert_recipients).
if [ -d /run/systemd/system ]; then
  install -m 0644 "$prod/systemd/constitution-watchdog.service" "$prod/systemd/constitution-watchdog.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now constitution-watchdog.timer > /dev/null
  echo "Watchdog timer enabled (every 10 minutes)."
else
  echo "No systemd: watchdog timer not installed."
fi
if [ ! -s secrets/alert_recipients ]; then
  echo "No alert recipients yet: add the GitHub secret ALERT_EMAILS and run a release."
fi

echo "== 6. Backup and audit-seal timers (Task S6)"
if [ -d /run/systemd/system ] && [ -n "$offsite_remote" ] && [ -n "$offsite_audit_remote" ]; then
  # The timers run at 01:30 and 02:30 Botswana time.
  timedatectl set-timezone Africa/Gaborone 2>/dev/null || true
  install -m 0644 "$prod"/systemd/constitution-backup.{service,timer} \
    "$prod"/systemd/constitution-audit-seal.{service,timer} /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now constitution-backup.timer constitution-audit-seal.timer > /dev/null
  echo "Nightly backup (01:30) and audit seal (02:30) timers enabled; off-site copies on."
else
  echo "Off-site location not set up yet (task S6): nightly timers not installed."
fi

echo "== 7. Record"
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$version" "${RELEASED_BY:-unknown}" >> "$root/releases.log"

# Keep the images of the last three releases (for a rollback), remove older ones.
for name in constitution-api constitution-web constitution-ops; do
  docker image ls "$name" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' | sort -r | tail -n +4 |
    cut -f2 | xargs -r docker image rm >/dev/null 2>&1 || true
done
echo "Release $version is running."
