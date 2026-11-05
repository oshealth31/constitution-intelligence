#!/usr/bin/env bash
# Tries ONCE to create the free Oracle Cloud Arm server "constitution-prod" (Task S2).
# Run every 15 minutes by .github/workflows/oracle-server.yml until it succeeds, because
# Oracle's free Arm servers in Johannesburg are often all in use ("Out of host capacity").
#
# Needs the OCI CLI, configured (~/.oci/config), and:
#   TENANCY_OCID     the Oracle account (tenancy); the server goes in its root compartment
#   SSH_PUBLIC_KEY   the public key that may sign in as "ubuntu"
# Optional: SERVER_NAME (constitution-prod), and SIZES (default "2:12 1:6" = try 2 OCPUs and
# 12 GB first, then 1 OCPU and 6 GB).
#
# Stays inside the Always Free allowance: Arm shape only, at most 2 OCPUs / 12 GB in total,
# boot volume 100 GB at the "Balanced" level (10 VPUs/GB). Never creates a second Arm server.
# Exit codes: 0 = created, or already exists; 3 = no capacity this time (try again later);
# anything else = a real problem that needs a person.
#
# Output never contains the server's IP address or keys (the workflow's log is public).
set -euo pipefail
: "${TENANCY_OCID:?}" "${SSH_PUBLIC_KEY:?}"
name="${SERVER_NAME:-constitution-prod}"
sizes="${SIZES:-2:12 1:6}"
shape=VM.Standard.A1.Flex
compartment="$TENANCY_OCID"

oci_json() { oci "$@" --output json; }

echo "== Existing Arm servers"
existing="$(oci_json compute instance list --compartment-id "$compartment" --all |
  jq -r --arg shape "$shape" '[.data[]? | select(.shape == $shape and
    (."lifecycle-state" | IN("TERMINATED", "TERMINATING") | not))] | length')"
if [ "$existing" != 0 ]; then
  echo "An Arm server already exists ($existing). Nothing to do."
  exit 0
fi
echo "None yet."

echo "== Network"
subnet="$(oci_json network subnet list --compartment-id "$compartment" --all |
  jq -r '[.data[]? | select(."prohibit-public-ip-on-vnic" == false and ."lifecycle-state" == "AVAILABLE")][0].id // empty')"
if [ -z "$subnet" ]; then
  echo "No public subnet found. Create the server once in the console (it makes the network), or ask for help." >&2
  exit 1
fi
echo "Public subnet found."

echo "== Image"
image="$(oci_json compute image list --compartment-id "$compartment" --all \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" --shape "$shape" \
  --sort-by TIMECREATED --sort-order DESC |
  jq -r '[.data[]? | select(."display-name" | test("Minimal") | not)][0].id // empty')"
[ -n "$image" ] || { echo "No Ubuntu 24.04 image for $shape was found." >&2; exit 1; }
echo "Ubuntu 24.04 image found."

ad="$(oci_json iam availability-domain list --compartment-id "$compartment" | jq -r '.data[0].name')"
source_details="$(jq -cn --arg image "$image" \
  '{sourceType: "image", imageId: $image, bootVolumeSizeInGBs: 100, bootVolumeVpusPerGB: 10}')"
metadata="$(jq -cn --arg key "$SSH_PUBLIC_KEY" '{ssh_authorized_keys: $key}')"

for size in $sizes; do
  ocpus="${size%%:*}" memory="${size##*:}"
  if [ "$ocpus" -gt 2 ] || [ "$memory" -gt 12 ]; then
    echo "Size $size is above the free allowance; skipped." >&2
    continue
  fi
  echo "== Trying $ocpus OCPU, $memory GB"
  set +e
  result="$(oci compute instance launch --output json \
    --compartment-id "$compartment" --availability-domain "$ad" \
    --display-name "$name" --shape "$shape" \
    --shape-config "{\"ocpus\": $ocpus, \"memoryInGBs\": $memory}" \
    --subnet-id "$subnet" --assign-public-ip true \
    --source-details "$source_details" --metadata "$metadata" 2>&1)"
  status=$?
  set -e
  if [ "$status" = 0 ]; then
    echo "Created: $name ($ocpus OCPU, $memory GB). Oracle is starting it now."
    echo "$result" | jq -r '.data.id' > /tmp/oracle-instance-id
    exit 0
  fi
  if grep -qiE 'out of (host )?capacity|TooManyRequests|LimitExceeded' <<<"$result"; then
    # Only the reason, never the full answer (it can contain account details).
    echo "Not this time: $(grep -oiE 'out of (host )?capacity|TooManyRequests|LimitExceeded' <<<"$result" | head -n 1)."
    continue
  fi
  echo "Oracle refused the request for another reason:" >&2
  grep -oE '"(code|message)": "[^"]*"' <<<"$result" | head -n 2 >&2 || true
  exit 1
done
exit 3
