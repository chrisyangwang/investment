#!/usr/bin/env bash
# Render a markdown research report to DOCX + PDF and upload all three formats
# to its Google Drive 研究报告Opus folder.
#
# Usage: scripts/publish-report.sh <markdown-path> <drive-folder-id>
set -euo pipefail

MD="${1:?usage: publish-report.sh <markdown-path> <drive-folder-id>}"
FOLDER="${2:?missing drive folder id}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ -f "$MD" ]] || { echo "not found: $MD" >&2; exit 1; }

stem="$(basename "$MD" .md)"
dir="$(dirname "$MD")"

echo "[publish] rendering $stem"
python3 "$REPO/scripts/md_to_docx_pdf.py" "$MD"

for ext in md docx pdf; do
  f="$dir/$stem.$ext"
  [[ -f "$f" ]] || { echo "[publish] ERROR missing $f" >&2; exit 1; }
  echo "[publish] uploading $stem.$ext"
  node "$REPO/scripts/drive-fetch.mjs" upload "$FOLDER" "$f" | sed 's/^/           /'
done

echo "[publish] folder now contains:"
node "$REPO/scripts/drive-fetch.mjs" list "$FOLDER" | sed 's/^/           /'
