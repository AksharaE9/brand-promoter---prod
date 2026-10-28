#!/usr/bin/env bash
# Smoke script for HireIQ External API integration
# Usage: ./smoke-hireiq.sh https://brandpromoter-backend.onrender.com <API_KEY> [CANDIDATE_ID]

BASE="${1:-http://localhost:4000}"
KEY="$2"
CANDIDATE_ID="${3:-cmvronjma006ftb08cqdxrff9}"

if [ -z "$KEY" ]; then
  echo "Usage: ./smoke-hireiq.sh BASE_URL API_KEY [CANDIDATE_ID]"
  exit 1
fi

echo "========================================================================"
echo "   HIREIQ EXTERNAL API SMOKE TEST: $BASE"
echo "========================================================================"

echo ""
echo "[1] Testing GET /api/v1/ext/me (Authentication & Scopes):"
curl -s "$BASE/api/v1/ext/me" -H "x-api-key: $KEY" | jq . || curl -s "$BASE/api/v1/ext/me" -H "x-api-key: $KEY"

echo ""
echo "[2] Testing GET /api/v1/ext/interviews (Date Range Filter in IST):"
curl -s "$BASE/api/v1/ext/interviews?from=2026-10-28&to=2026-11-10" -H "x-api-key: $KEY" | jq . || curl -s "$BASE/api/v1/ext/interviews?from=2026-10-28&to=2026-11-10" -H "x-api-key: $KEY"

echo ""
echo "[3] Testing GET /api/v1/ext/interviews (Polling via updatedSince):"
curl -s "$BASE/api/v1/ext/interviews?updatedSince=2026-10-27T00:00:00%2B05:30" -H "x-api-key: $KEY" | jq . || curl -s "$BASE/api/v1/ext/interviews?updatedSince=2026-10-27T00:00:00%2B05:30" -H "x-api-key: $KEY"

echo ""
echo "[4] Testing GET /api/v1/ext/candidates/$CANDIDATE_ID/resume (Resume Stream):"
curl -s -o resume.bin -w "HTTP: %{http_code} | Content-Type: %{content_type}\n" \
     "$BASE/api/v1/ext/candidates/$CANDIDATE_ID/resume" -H "x-api-key: $KEY"

echo ""
echo "[5] Testing Security Isolation: No key -> Expected 401 API_KEY_MISSING:"
curl -s -w "HTTP: %{http_code}\n" "$BASE/api/v1/ext/me"

echo ""
echo "[6] Testing Route Separation: API key on internal /api/candidates -> Expected 401:"
curl -s -w "HTTP: %{http_code}\n" "$BASE/api/candidates" -H "x-api-key: $KEY"

echo ""
echo "Smoke test complete."
