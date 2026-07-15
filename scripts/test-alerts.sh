#!/usr/bin/env bash
# test-alerts.sh — Manual test harness for the Renewl alert pipeline.
# Usage: ./scripts/test-alerts.sh [--seed] [--status] [--reset] [--fire [--prod]] [--clean]
set -euo pipefail

# ── ANSI colours (declared early so usage block can use them) ─────────────
YELLOW=$'\033[0;33m'
GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

# ── Resolve repo root and load .env.local ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env.local not found at $ENV_FILE" >&2
  exit 1
fi

# Load env vars — set -a auto-exports everything sourced
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ── Early exit: no flags → show usage (before env validation) ─────────────
if [[ $# -eq 0 ]]; then
  # Define usage inline here since the function isn't declared yet
  cat <<EOF

${BOLD}test-alerts.sh${RESET} — Manual test harness for the Renewl alert pipeline

${BOLD}USAGE${RESET}
  ./scripts/test-alerts.sh [FLAGS...]

${BOLD}FLAGS${RESET}
  --seed          Insert 4 TEST contracts + 1 pending alert each (scheduled today)
                  Covers: with/without annual_value, auto_renew, notice_period_days
  --status        Print current alert status for all TEST contracts
  --reset         Reset sent/skipped/failed alerts back to pending
  --fire          POST to local cron endpoint (http://localhost:3000)
  --fire --prod   POST to production cron endpoint (\$APP_URL)
  --clean         Delete all TEST alerts and contracts

${BOLD}EXAMPLES${RESET}
  ./scripts/test-alerts.sh --seed --fire
  ./scripts/test-alerts.sh --reset --fire
  ./scripts/test-alerts.sh --reset --fire --prod
  ./scripts/test-alerts.sh --status
  ./scripts/test-alerts.sh --clean

${BOLD}ENV VARS${RESET} (from .env.local)
  NEXT_PUBLIC_SUPABASE_URL    Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY   Service role key (bypasses RLS)
  CRON_SECRET                 Bearer token for cron route
  APP_URL                     Production URL (required for --prod)
  TEST_EMAIL                  Account email for seeded contracts (optional — prompted if missing)

EOF
  exit 0
fi

# ── Validate required env vars ────────────────────────────────────────────
missing=()
[[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]] && missing+=("NEXT_PUBLIC_SUPABASE_URL")
[[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]] && missing+=("SUPABASE_SERVICE_ROLE_KEY")
[[ -z "${CRON_SECRET:-}" ]]               && missing+=("CRON_SECRET")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing required env vars in .env.local:" >&2
  for v in "${missing[@]}"; do echo "  - $v" >&2; done
  exit 1
fi

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL%/}"   # strip trailing slash
REST_BASE="$SUPABASE_URL/rest/v1"

# ── Supabase REST helpers ─────────────────────────────────────────────────
supabase_get() {
  # Usage: supabase_get <path-and-query>
  curl -sSL \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    "$REST_BASE/$1"
}

supabase_post() {
  # Usage: supabase_post <path> <json-body>
  curl -sSL \
    -X POST \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "$2" \
    "$REST_BASE/$1"
}

supabase_patch() {
  # Usage: supabase_patch <path-and-query> <json-body>
  curl -sSL \
    -X PATCH \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "$2" \
    "$REST_BASE/$1"
}

supabase_delete() {
  # Usage: supabase_delete <path-and-query>
  # Returns the deleted rows (Prefer: return=representation)
  curl -sSL \
    -X DELETE \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    "$REST_BASE/$1"
}

# ── Resolve test user UUID ────────────────────────────────────────────────
resolve_user_id() {
  local email="${TEST_EMAIL:-}"
  if [[ -z "$email" ]]; then
    printf "TEST_EMAIL not set in .env.local.\nEnter your account email: " >&2
    read -r email
  fi
  local result
  result=$(supabase_get "profiles?email=eq.$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$email")&select=id")
  local uid
  uid=$(echo "$result" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'] if rows else '')" 2>/dev/null || true)
  if [[ -z "$uid" ]]; then
    echo "ERROR: Could not find profile for email '$email'. Is this a real Renewl account?" >&2
    exit 1
  fi
  echo "$uid"
}

# ── TODAY in YYYY-MM-DD ───────────────────────────────────────────────────
TODAY=$(date -u +%Y-%m-%d)

date_offset() {
  # Cross-platform: macOS uses -v, Linux uses -d
  local days="$1"
  if date -v+0d > /dev/null 2>&1; then
    # macOS
    date -u -v+"${days}"d +%Y-%m-%d
  else
    # GNU/Linux
    date -u -d "$TODAY + $days days" +%Y-%m-%d
  fi
}

# ── Flag parsing ──────────────────────────────────────────────────────────

DO_SEED=false
DO_STATUS=false
DO_RESET=false
DO_FIRE=false
FIRE_PROD=false
DO_CLEAN=false

# Parse flags in order, preserving left-to-right execution sequence
ORDERED_OPS=()

i=1
while [[ $i -le $# ]]; do
  arg="${!i}"
  case "$arg" in
    --seed)   DO_SEED=true;   ORDERED_OPS+=("seed") ;;
    --status) DO_STATUS=true; ORDERED_OPS+=("status") ;;
    --reset)  DO_RESET=true;  ORDERED_OPS+=("reset") ;;
    --fire)
      DO_FIRE=true
      # Peek at next arg
      next_i=$((i + 1))
      if [[ $next_i -le $# && "${!next_i}" == "--prod" ]]; then
        FIRE_PROD=true
        i=$next_i
      fi
      ORDERED_OPS+=("fire")
      ;;
    --prod)
      # --prod without --fire: ignore (handled above)
      ;;
    --clean)  DO_CLEAN=true;  ORDERED_OPS+=("clean") ;;
    *)
      echo "ERROR: Unknown flag: $arg" >&2
      usage
      exit 1
      ;;
  esac
  i=$((i + 1))
done

# ── Operation: seed ───────────────────────────────────────────────────────
op_seed() {
  echo -e "\n${BOLD}${CYAN}── SEED ──────────────────────────────────────────${RESET}"
  local user_id
  user_id=$(resolve_user_id)
  echo "User ID: $user_id"

  # Format: "name|alert_type|expiry_offset|renewal_date_offset_or_empty|notice_period_days_or_empty|contract_value_or_empty|annual_value_or_empty|auto_renew"
  # Covers: with/without annual_value (email annualValueBlock), auto_renew true/false, with/without notice period
  local contracts=(
    "TEST – 60-Day SaaS (annual value + notice)|day_60|60|90|30|\$2,000/month|24000|false"
    "TEST – 30-Day Lease (auto-renew, no notice)|day_30|30|60||\$4,166/month|50000|true"
    "TEST – 7-Day Vendor (no value fields)|day_7|7|14||||false"
    "TEST – Notice Deadline (high-value auto-renew)|notice_deadline|1|30||\$15,000/year|15000|true"
  )

  for entry in "${contracts[@]}"; do
    IFS='|' read -r name alert_type expiry_offset renewal_offset notice_days contract_value annual_value auto_renew <<< "$entry"

    local expiry_date
    expiry_date=$(date_offset "$expiry_offset")

    local renewal_date_field=""
    if [[ -n "$renewal_offset" ]]; then
      local renewal_date
      renewal_date=$(date_offset "$renewal_offset")
      renewal_date_field='"renewal_date": "'"$renewal_date"'",'
    fi

    local notice_field=""
    if [[ -n "$notice_days" ]]; then
      notice_field='"notice_period_days": '"$notice_days"','
    fi

    local value_field=""
    if [[ -n "$contract_value" && "$contract_value" != "null" ]]; then
      value_field='"contract_value": "'"$contract_value"'",'
    fi

    local annual_field=""
    if [[ -n "$annual_value" && "$annual_value" != "null" ]]; then
      annual_field='"annual_value": '"$annual_value"','
    fi

    # Insert contract
    local contract_json
    contract_json=$(cat <<JSON
{
  "user_id": "$user_id",
  "name": "$name",
  "category": "vendor",
  "party_a": "Acme Corp",
  "party_b": "Test Vendor Inc",
  "expiry_date": "$expiry_date",
  $renewal_date_field
  $notice_field
  $value_field
  $annual_field
  "auto_renew": $auto_renew,
  "status": "active",
  "extraction_status": "confirmed"
}
JSON
)
    local contract_result
    contract_result=$(supabase_post "contracts" "$contract_json")
    local contract_id
    contract_id=$(echo "$contract_result" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'])" 2>/dev/null || true)

    if [[ -z "$contract_id" ]]; then
      echo -e "  ${RED}FAILED${RESET} to insert contract: $name" >&2
      echo "  Response: $contract_result" >&2
      continue
    fi

    # Insert alert
    local alert_json
    alert_json=$(cat <<JSON
{
  "contract_id": "$contract_id",
  "user_id": "$user_id",
  "alert_type": "$alert_type",
  "scheduled_for": "$TODAY",
  "target_date": "$expiry_date",
  "status": "pending"
}
JSON
)
    local alert_result
    alert_result=$(supabase_post "alerts" "$alert_json")
    local alert_id
    alert_id=$(echo "$alert_result" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(rows[0]['id'])" 2>/dev/null || true)

    if [[ -z "$alert_id" ]]; then
      echo -e "  ${RED}FAILED${RESET} to insert alert for: $name" >&2
      echo "  Response: $alert_result" >&2
      continue
    fi

    local av_display="${annual_value:-none}"
    local notice_display="${notice_days:-none}"
    echo -e "  ${GREEN}✓${RESET} $name"
    echo -e "      contract_id:    $contract_id"
    echo -e "      alert_id:       $alert_id  [${alert_type}  scheduled_for=${TODAY}]"
    echo -e "      annual_value:   $av_display  |  notice_period_days: $notice_display  |  auto_renew: $auto_renew"
  done
}

# ── Operation: status ─────────────────────────────────────────────────────
op_status() {
  echo -e "\n${BOLD}${CYAN}── STATUS ─────────────────────────────────────────${RESET}"

  # Fetch all alerts with embedded contract name, filter TEST* in Python.
  # (PostgREST embedded-resource filtering requires !inner and is version-sensitive;
  #  simpler to filter client-side for a test script.)
  local data
  data=$(supabase_get "alerts?select=alert_type,status,sent_at,contracts(name)&order=alert_type.asc")

  local filtered
  filtered=$(echo "$data" | python3 -c "
import json, sys
rows = json.load(sys.stdin)
out = [r for r in rows if r.get('contracts') and r['contracts'].get('name', '').startswith('TEST')]
out.sort(key=lambda r: (r['contracts']['name'], r['alert_type']))
print(json.dumps(out))
")

  local count
  count=$(echo "$filtered" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")

  if [[ "$count" -eq 0 ]]; then
    echo "  No TEST alerts found. Run --seed first."
    return
  fi

  # Print table header
  printf "\n  %-40s  %-18s  %-10s  %s\n" "Contract Name" "Alert Type" "Status" "Sent At"
  printf "  %-40s  %-18s  %-10s  %s\n" "$(printf '%0.s─' {1..40})" "$(printf '%0.s─' {1..18})" "$(printf '%0.s─' {1..10})" "$(printf '%0.s─' {1..24})"

  echo "$filtered" | python3 -c "
import json, sys
YELLOW = '\033[0;33m'
GREEN  = '\033[0;32m'
RED    = '\033[0;31m'
RESET  = '\033[0m'
rows = json.load(sys.stdin)
for r in rows:
    name    = (r.get('contracts') or {}).get('name', '(unknown)')[:40]
    atype   = r.get('alert_type', '')
    status  = r.get('status', '')
    sent_at = r.get('sent_at') or ''
    colour  = YELLOW if status == 'pending' else GREEN if status == 'sent' else RED if status in ('skipped', 'failed') else ''
    print(f'  {name:<40}  {atype:<18}  {colour}{status:<10}{RESET}  {sent_at}')
"

  echo ""
}

# ── Operation: reset ──────────────────────────────────────────────────────
op_reset() {
  echo -e "\n${BOLD}${CYAN}── RESET ──────────────────────────────────────────${RESET}"

  # Get contract IDs for TEST contracts
  local contract_ids_json
  contract_ids_json=$(supabase_get "contracts?name=like.TEST%25&select=id")
  local ids_csv
  ids_csv=$(echo "$contract_ids_json" | python3 -c "import json,sys; rows=json.load(sys.stdin); print(','.join(r['id'] for r in rows))" 2>/dev/null || true)

  if [[ -z "$ids_csv" ]]; then
    echo "  No TEST contracts found. Run --seed first."
    return
  fi

  # Build PostgREST IN filter
  local id_filter
  id_filter=$(echo "$contract_ids_json" | python3 -c "
import json, sys, urllib.parse
rows = json.load(sys.stdin)
ids = ','.join(r['id'] for r in rows)
print('in.(' + ids + ')')
" 2>/dev/null || true)

  local result
  result=$(supabase_patch \
    "alerts?contract_id=${id_filter}&status=in.(sent,skipped,failed)" \
    '{"status":"pending","sent_at":null}')

  local reset_count
  reset_count=$(echo "$result" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  echo -e "  ${GREEN}✓${RESET} Reset ${reset_count} alert(s) to pending."
}

# ── Operation: fire ───────────────────────────────────────────────────────
op_fire() {
  local target_url
  if [[ "$FIRE_PROD" == true ]]; then
    if [[ -z "${APP_URL:-}" ]]; then
      echo "ERROR: APP_URL is not set in .env.local (required for --prod)" >&2
      exit 1
    fi
    target_url="${APP_URL%/}/api/cron/send-alerts"
    echo -e "\n${BOLD}${CYAN}── FIRE (PRODUCTION) ──────────────────────────────${RESET}"
    echo -e "  ${YELLOW}WARNING: Firing against PRODUCTION at $target_url${RESET}"
  else
    target_url="http://localhost:3000/api/cron/send-alerts"
    echo -e "\n${BOLD}${CYAN}── FIRE (LOCAL) ───────────────────────────────────${RESET}"
  fi

  echo "  POST $target_url"

  local http_code body
  body=$(curl -sS \
    -o /tmp/test-alerts-response.json \
    -w "%{http_code}" \
    -X GET \
    -H "Authorization: Bearer $CRON_SECRET" \
    "$target_url" 2>&1) || true

  http_code="$body"
  body=$(cat /tmp/test-alerts-response.json 2>/dev/null || echo '{}')

  # Colour-code HTTP status
  if [[ "$http_code" == "200" ]]; then
    echo -e "  HTTP Status: ${GREEN}${http_code}${RESET}"
  else
    echo -e "  HTTP Status: ${RED}${http_code}${RESET}"
  fi

  echo -e "\n  Response:"
  echo "$body" | python3 -c "
import json, sys
GREEN  = '\033[0;32m'
RED    = '\033[0;31m'
BOLD   = '\033[1m'
RESET  = '\033[0m'
try:
    data   = json.load(sys.stdin)
    sent   = data.get('sent', 'N/A')
    failed = data.get('failed', 'N/A')
    total  = data.get('total', 'N/A')
    print('  ' + json.dumps(data, indent=4))
    print()
    print(f'  {BOLD}Summary:{RESET}')
    print(f'    Sent:   {GREEN}{sent}{RESET}')
    fc = RED if (isinstance(failed, int) and failed != 0) else ''
    print(f'    Failed: {fc}{failed}{RESET}')
    print(f'    Total:  {total}')
except Exception as e:
    print(f'  (could not parse JSON response: {e})')
"
}

# ── Operation: clean ──────────────────────────────────────────────────────
op_clean() {
  echo -e "\n${BOLD}${CYAN}── CLEAN ──────────────────────────────────────────${RESET}"

  # Get TEST contract IDs first
  local contract_ids_json
  contract_ids_json=$(supabase_get "contracts?name=like.TEST%25&select=id")
  local count_contracts
  count_contracts=$(echo "$contract_ids_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  if [[ "$count_contracts" -eq 0 ]]; then
    echo "  No TEST contracts found. Nothing to clean."
    return
  fi

  local id_filter
  id_filter=$(echo "$contract_ids_json" | python3 -c "
import json, sys
rows = json.load(sys.stdin)
ids = ','.join(r['id'] for r in rows)
print('in.(' + ids + ')')
" 2>/dev/null || true)

  # Delete alerts first (FK constraint)
  local deleted_alerts
  deleted_alerts=$(supabase_delete "alerts?contract_id=${id_filter}")
  local alert_count
  alert_count=$(echo "$deleted_alerts" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  # Delete contracts
  local deleted_contracts
  deleted_contracts=$(supabase_delete "contracts?name=like.TEST%25")
  local contract_count
  contract_count=$(echo "$deleted_contracts" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

  echo -e "  ${GREEN}✓${RESET} Deleted ${alert_count} alert(s)."
  echo -e "  ${GREEN}✓${RESET} Deleted ${contract_count} contract(s)."
}

# ── Execute operations in order ───────────────────────────────────────────
for op in "${ORDERED_OPS[@]}"; do
  case "$op" in
    seed)   op_seed ;;
    status) op_status ;;
    reset)  op_reset ;;
    fire)   op_fire ;;
    clean)  op_clean ;;
  esac
done

echo ""
