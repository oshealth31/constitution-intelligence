#!/usr/bin/env bash
# Sets up the off-site backup location in the owner's Oracle Cloud account (Task S6).
# Run by the Deploy workflow (task: setup-offsite) with the OCI CLI signed in as the owner.
# Safe to run again: everything that already exists is kept.
#
# Creates, in Johannesburg (the free Object Storage allowance, 20 GB):
#   - bucket constitution-backups      retention rule 35 days, objects deleted after 100 days
#   - bucket constitution-audit-seals  retention rule 7 years (sealed audit batches, a few KB)
#     A retention rule means no one can delete or change an object until it is old enough.
#     The rules are NOT locked, so they can still be changed by the owner; locking is a
#     decision for the go-live check (S7, docs/operations/backup-and-restore.md).
#   - user constitution-backup-writer in group constitution-backup-writers, allowed only to
#     LIST, READ and ADD objects in these two buckets (not delete, not overwrite)
#   - an S3 access key for that user, printed ONLY to the file given as the first argument
#     (rclone configuration), never to the log. Skipped if KEEP_EXISTING_KEY=1.
#
# Needs: TENANCY_OCID; the OCI CLI configured for region af-johannesburg-1.
set -euo pipefail
: "${TENANCY_OCID:?}"
rclone_out="${1:?Usage: oracle-setup-offsite.sh <rclone.conf to write>}"
region=af-johannesburg-1
compartment="$TENANCY_OCID"
backups=constitution-backups
seals=constitution-audit-seals
user_name=constitution-backup-writer
group_name=constitution-backup-writers
policy_name=constitution-backup-writer-policy
service_policy_name=constitution-object-lifecycle

oci_json() { oci "$@" --output json; }
namespace="$(oci_json os ns get | jq -r '.data')"
echo "Object Storage ready in $region."

echo "== Buckets"
for bucket in "$backups" "$seals"; do
  if oci os bucket get --namespace-name "$namespace" --bucket-name "$bucket" --output json > /dev/null 2>&1; then
    echo "$bucket: exists"
  else
    oci os bucket create --namespace-name "$namespace" --compartment-id "$compartment" \
      --name "$bucket" --public-access-type NoPublicAccess --storage-tier Standard \
      --versioning Disabled --output json > /dev/null
    echo "$bucket: created"
  fi
done

retention() {  # bucket name amount unit
  local bucket="$1" name="$2" amount="$3" unit="$4"
  if oci_json os retention-rule list --namespace-name "$namespace" --bucket-name "$bucket" |
    jq -e --arg n "$name" '.data.items[]? | select(."display-name" == $n)' > /dev/null; then
    echo "$bucket: retention rule present"
  else
    oci os retention-rule create --namespace-name "$namespace" --bucket-name "$bucket" \
      --display-name "$name" --time-amount "$amount" --time-unit "$unit" --output json > /dev/null
    echo "$bucket: retention rule added ($amount $unit)"
  fi
}
echo "== Retention (no deleting or changing objects before this age)"
retention "$backups" keep-35-days 35 DAYS
retention "$seals" keep-7-years 7 YEARS

echo "== Old backups removed automatically after 100 days"
policy_id() {
  oci_json iam policy list --compartment-id "$compartment" --all |
    jq -r --arg n "$1" '.data[]? | select(.name == $n) | .id' | head -n 1
}
if [ -z "$(policy_id "$service_policy_name")" ]; then
  oci iam policy create --compartment-id "$compartment" --name "$service_policy_name" \
    --description "Lets Object Storage delete old backups by the lifecycle rule (Task S6)" \
    --statements "[\"Allow service objectstorage-$region to manage object-family in tenancy\"]" \
    --output json > /dev/null
  echo "service policy created"
  sleep 20  # policies take a moment to apply
fi
oci os object-lifecycle-policy put --namespace-name "$namespace" --bucket-name "$backups" --force \
  --items '[{"name":"delete-after-100-days","action":"DELETE","timeAmount":100,"timeUnit":"DAYS","isEnabled":true,"target":"objects"}]' \
  --output json > /dev/null
echo "$backups: lifecycle rule set"

echo "== Add-only account for the server"
group_id="$(oci_json iam group list --compartment-id "$compartment" --all |
  jq -r --arg n "$group_name" '.data[]? | select(.name == $n) | .id' | head -n 1)"
if [ -z "$group_id" ]; then
  group_id="$(oci_json iam group create --compartment-id "$compartment" --name "$group_name" \
    --description "The backup server: list, read and add backup files only (Task S6)" | jq -r '.data.id')"
  echo "group created"
fi
user_id="$(oci_json iam user list --compartment-id "$compartment" --all |
  jq -r --arg n "$user_name" '.data[]? | select(.name == $n) | .id' | head -n 1)"
if [ -z "$user_id" ]; then
  user_id="$(oci_json iam user create --compartment-id "$compartment" --name "$user_name" \
    --description "Used only by the Constitution Intelligence server to add backups (Task S6)" | jq -r '.data.id')"
  echo "user created"
fi
if ! oci_json iam group list-users --group-id "$group_id" --compartment-id "$compartment" --all |
  jq -e --arg u "$user_id" '.data[]? | select(.id == $u)' > /dev/null; then
  oci iam group add-user --group-id "$group_id" --user-id "$user_id" --output json > /dev/null
  echo "user added to group"
fi
buckets_condition="any {target.bucket.name='$backups', target.bucket.name='$seals'}"
statements="$(jq -cn --arg g "$group_name" --arg b "$buckets_condition" '[
  "Allow group \($g) to read buckets in tenancy where \($b)",
  "Allow group \($g) to manage objects in tenancy where all {\($b), any {request.permission='"'"'OBJECT_CREATE'"'"', request.permission='"'"'OBJECT_INSPECT'"'"', request.permission='"'"'OBJECT_READ'"'"'}}"
]')"
existing_policy="$(policy_id "$policy_name")"
if [ -z "$existing_policy" ]; then
  oci iam policy create --compartment-id "$compartment" --name "$policy_name" \
    --description "Backup server: list, read and add objects in the backup buckets only (Task S6)" \
    --statements "$statements" --output json > /dev/null
  echo "policy created"
else
  oci iam policy update --policy-id "$existing_policy" --statements "$statements" --force \
    --output json > /dev/null
  echo "policy updated"
fi

if [ "${KEEP_EXISTING_KEY:-0}" = 1 ]; then
  echo "Keeping the existing access key."
  exit 0
fi
echo "== Access key"
# A user may hold at most two keys: remove the oldest when two exist already.
keys="$(oci_json iam customer-secret-key list --user-id "$user_id")"
if [ "$(jq '.data | length' <<<"$keys")" -ge 2 ]; then
  oldest="$(jq -r '.data | sort_by(."time-created") | .[0].id' <<<"$keys")"
  oci iam customer-secret-key delete --user-id "$user_id" --customer-secret-key-id "$oldest" --force
  echo "oldest access key removed"
fi
created="$(oci_json iam customer-secret-key create --user-id "$user_id" \
  --display-name "server $(date -u +%F)")"
key_id="$(jq -r '.data.id' <<<"$created")"
secret="$(jq -r '.data.key' <<<"$created")"
[ -n "$key_id" ] && [ -n "$secret" ] && [ "$secret" != null ] || { echo "No access key returned." >&2; exit 1; }
if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$secret"; fi
umask 077
cat > "$rclone_out" <<CONF
# Off-site backups (Task S6): Oracle Object Storage, Johannesburg, add-only account.
[offsite]
type = s3
provider = Other
access_key_id = $key_id
secret_access_key = $secret
endpoint = https://$namespace.compat.objectstorage.$region.oraclecloud.com
region = $region
force_path_style = true
no_check_bucket = true
CONF
echo "Access key created and written to the rclone configuration (not shown)."
