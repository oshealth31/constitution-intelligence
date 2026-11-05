#!/usr/bin/env bash
# ZAP options for the signed-in scans (task T5). Prints ZAP "-config" settings that make every
# request carry the session cookie ($SESSION) and the anti-forgery header, and that send
# requests which would end the session to an address that does not exist, so the scan stays
# signed in. Values contain no spaces (ZAP splits these options on spaces).
set -euo pipefail
: "${SESSION:?SESSION must be set}"
rules=(
  "REQ_HEADER|Cookie|ci_session=${SESSION}"
  "REQ_HEADER|X-Requested-With|XMLHttpRequest"
  "REQ_HEADER_STR|/api/v1/auth/logout|/api/v1/blocked-by-scan/logout"
  "REQ_HEADER_STR|/api/v1/auth/password/change|/api/v1/blocked-by-scan/password"
  "REQ_HEADER_STR|/api/v1/auth/two-step/|/api/v1/blocked-by-scan/two-step/"
)
options=()
for index in "${!rules[@]}"; do
  IFS='|' read -r type match replacement <<<"${rules[$index]}"
  prefix="-config replacer.full_list(${index})"
  options+=("${prefix}.description=scan${index}" "${prefix}.enabled=true"
    "${prefix}.matchtype=${type}" "${prefix}.matchstr=${match}" "${prefix}.regex=false"
    "${prefix}.replacement=${replacement}" "${prefix}.initiators=")
done
echo "${options[*]}"
