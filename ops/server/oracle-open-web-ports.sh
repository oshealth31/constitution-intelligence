#!/usr/bin/env bash
# Opens TCP 80 and 443 from anywhere in the security lists of the public subnet (Task S2), so
# the owner does not have to do it in the console. Keeps every existing rule. Safe to repeat.
# Needs the OCI CLI (configured) and TENANCY_OCID.
set -euo pipefail
: "${TENANCY_OCID:?}"

subnet_json="$(oci network subnet list --compartment-id "$TENANCY_OCID" --all --output json |
  jq -c '[.data[]? | select(."prohibit-public-ip-on-vnic" == false and ."lifecycle-state" == "AVAILABLE")][0] // empty')"
[ -n "$subnet_json" ] || { echo "No public subnet found." >&2; exit 1; }

for list in $(jq -r '."security-list-ids"[]' <<<"$subnet_json"); do
  current="$(oci network security-list get --security-list-id "$list" --output json)"
  # The CLI shows rules with dashed names but expects camelCase when they are sent back.
  rules="$(jq -c '.data."ingress-security-rules"
    | walk(if type == "object" then with_entries(.key |= gsub("-(?<c>[a-z])"; .c | ascii_upcase)) else . end)
    | walk(if type == "object" then with_entries(select(.value != null)) else . end)' <<<"$current")"
  changed=false
  for port in 80 443; do
    has="$(jq --argjson p "$port" 'any(.[]; .protocol == "6" and .source == "0.0.0.0/0"
      and .tcpOptions.destinationPortRange.min == $p and .tcpOptions.destinationPortRange.max == $p)' <<<"$rules")"
    if [ "$has" = false ]; then
      rules="$(jq -c --argjson p "$port" '. + [{protocol: "6", source: "0.0.0.0/0", sourceType: "CIDR_BLOCK",
        isStateless: false, description: "Constitution Intelligence web",
        tcpOptions: {destinationPortRange: {min: $p, max: $p}}}]' <<<"$rules")"
      changed=true
      echo "Opening port $port."
    fi
  done
  if [ "$changed" = true ]; then
    oci network security-list update --security-list-id "$list" \
      --ingress-security-rules "$rules" --force --output json > /dev/null
    echo "Security list updated."
  else
    echo "Ports 80 and 443 are already open."
  fi
done
