#!/bin/bash
# Ingest all education documents into Vectorize via the eClassroom RAG endpoint
# Usage: bash scripts/ingest-education-docs.sh <ADMIN_TOKEN>

API="https://askozzy.work"
TOKEN="${1:?Usage: bash scripts/ingest-education-docs.sh <ADMIN_TOKEN>}"
DOCS_DIR="knowledge-docs/education"
SUCCESS=0
FAILED=0
TOTAL_CHUNKS=0

echo "=== eClassroom RAG Ingestion ==="
echo "API: $API"
echo ""

# ─── Ingest WASSCE exam JSONs ───
echo "--- WASSCE Past Papers ---"
for f in $DOCS_DIR/wassce/*.json; do
  fname=$(basename "$f")
  echo -n "  Ingesting $fname... "

  # Read the JSON file and POST it with type=exam
  EXAM_TYPE=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('exam_type','wassce'))")
  SUBJECT=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('subject',''))")
  YEAR=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('year',2024))")
  PAPER=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('paper',1))")
  QUESTIONS=$(python3 -c "import json,sys; d=json.load(open('$f')); json.dump(d.get('questions',[]),sys.stdout)")

  BODY=$(python3 -c "
import json, sys
d = json.load(open('$f'))
payload = {
  'type': 'exam',
  'exam_type': d.get('exam_type', 'wassce'),
  'subject': d.get('subject', ''),
  'year': d.get('year', 2024),
  'paper': d.get('paper', 1),
  'questions': d.get('questions', [])
}
json.dump(payload, sys.stdout)
")

  RESULT=$(curl -s -X POST "$API/api/eclassroom/rag/ingest" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY")

  INGESTED=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('ingested',0))" 2>/dev/null || echo "0")
  ERR=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [ -n "$ERR" ] && [ "$ERR" != "" ]; then
    echo "FAILED: $ERR"
    FAILED=$((FAILED + 1))
  else
    echo "OK ($INGESTED chunks)"
    SUCCESS=$((SUCCESS + 1))
    TOTAL_CHUNKS=$((TOTAL_CHUNKS + INGESTED))
  fi
done

# ─── Ingest BECE exam JSONs ───
echo ""
echo "--- BECE Past Papers ---"
for f in $DOCS_DIR/bece/*.json; do
  fname=$(basename "$f")
  echo -n "  Ingesting $fname... "

  BODY=$(python3 -c "
import json, sys
d = json.load(open('$f'))
payload = {
  'type': 'exam',
  'exam_type': d.get('exam_type', 'bece'),
  'subject': d.get('subject', ''),
  'year': d.get('year', 2024),
  'paper': d.get('paper', 1),
  'questions': d.get('questions', [])
}
json.dump(payload, sys.stdout)
")

  RESULT=$(curl -s -X POST "$API/api/eclassroom/rag/ingest" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY")

  INGESTED=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('ingested',0))" 2>/dev/null || echo "0")
  ERR=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [ -n "$ERR" ] && [ "$ERR" != "" ]; then
    echo "FAILED: $ERR"
    FAILED=$((FAILED + 1))
  else
    echo "OK ($INGESTED chunks)"
    SUCCESS=$((SUCCESS + 1))
    TOTAL_CHUNKS=$((TOTAL_CHUNKS + INGESTED))
  fi
done

# ─── Ingest WAEC Syllabi (text files) ───
echo ""
echo "--- WAEC Syllabi ---"
for f in $DOCS_DIR/waec-*.txt; do
  fname=$(basename "$f")
  # Extract subject from filename: waec-core-mathematics-syllabus.txt -> Core Mathematics
  SUBJECT=$(echo "$fname" | sed 's/waec-syllabus-//;s/waec-//;s/-syllabus\.txt//;s/-/ /g' | python3 -c "import sys; print(sys.stdin.read().strip().title())")

  echo -n "  Ingesting $fname ($SUBJECT)... "

  TEXT=$(cat "$f")
  BODY=$(python3 -c "
import json, sys
text = open('$f', encoding='utf-8').read()
payload = {
  'type': 'syllabus',
  'subject': '$SUBJECT',
  'year': 2024,
  'text': text
}
json.dump(payload, sys.stdout)
")

  RESULT=$(curl -s -X POST "$API/api/eclassroom/rag/ingest" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY")

  INGESTED=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('ingested',0))" 2>/dev/null || echo "0")
  ERR=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [ -n "$ERR" ] && [ "$ERR" != "" ]; then
    echo "FAILED: $ERR"
    FAILED=$((FAILED + 1))
  else
    echo "OK ($INGESTED chunks)"
    SUCCESS=$((SUCCESS + 1))
    TOTAL_CHUNKS=$((TOTAL_CHUNKS + INGESTED))
  fi
done

echo ""
echo "=== Ingestion Complete ==="
echo "  Files processed: $((SUCCESS + FAILED))"
echo "  Successful: $SUCCESS"
echo "  Failed: $FAILED"
echo "  Total chunks ingested: $TOTAL_CHUNKS"
