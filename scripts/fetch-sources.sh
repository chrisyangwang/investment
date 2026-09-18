#!/usr/bin/env bash
# Rebuild the local research corpus for one company: download every PDF from its
# three Google Drive source folders and convert each to text.
#
# The corpus is gitignored because it is large and reproducible, so this script is
# what you run after a VM reset.
#
# Usage: scripts/fetch-sources.sh <slug>
#   slug: mkw (密尔克卫) | aj (安井食品) | hl (华鲁恒升)
set -euo pipefail

SLUG="${1:?usage: fetch-sources.sh <mkw|aj|hl>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$SLUG" in
  mkw) FIN=19uZOAtpzM09QD55Suep1pEHHSmXvLPro
       RES=1EGd9Fpk44ESRpCq8cwre7vZ43g1vttp8
       WX=1OKAjX8qDanN5I8Q60N2JHZ8ymbeq4uDg ;;
  aj)  FIN=1wMlCn2tA9njO1Yj4xCtns1efY0fnJkts
       RES=10hymrYMIbMechxKM5HP5mFOSdrpuvtNw
       WX=18y0AqUJCEWe0F_CKG9Ohqg6mzzPr96sp ;;
  hl)  FIN=1yoyjED8LtC4h-CG9QwO72UGPN652DUpN
       RES=1QLLhJcOjtOQniHxZ31WgNFoAiEigjVXr
       WX=1vVI9aeqQNrwNi-Ma26liKeDeukYJSpv5 ;;
  *)   echo "unknown slug: $SLUG (use mkw|aj|hl)" >&2; exit 2 ;;
esac

PDFDIR="/tmp/src-$SLUG"
TXTDIR="$REPO/data/$SLUG/txt"

for pair in "财报:$FIN" "研报:$RES" "公众号:$WX"; do
  label="${pair%%:*}"; fid="${pair##*:}"
  mkdir -p "$PDFDIR/$label"
  echo "[fetch] $SLUG/$label"
  node "$REPO/scripts/drive-fetch.mjs" pull "$fid" "$PDFDIR/$label" | tail -1
done

echo "[fetch] converting to text"
PDFDIR="$PDFDIR" TXTDIR="$TXTDIR" python3 - <<'PY'
import os, pathlib, sys
import pymupdf

src = pathlib.Path(os.environ["PDFDIR"])
dst = pathlib.Path(os.environ["TXTDIR"])
ok = skipped = failed = 0
for pdf in sorted(src.rglob("*.pdf")):
    out = dst / pdf.parent.name / (pdf.stem + ".txt")
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and out.stat().st_size > 0:
        skipped += 1
        continue
    try:
        with pymupdf.open(pdf) as doc, out.open("w", encoding="utf-8") as fh:
            for i, page in enumerate(doc, 1):
                fh.write(f"\n===== PAGE {i} =====\n")
                fh.write(page.get_text())
        ok += 1
    except Exception as exc:
        print(f"  FAIL {pdf.name}: {exc}", file=sys.stderr)
        failed += 1

print(f"converted={ok} skipped={skipped} failed={failed}")
for d in sorted(p for p in dst.iterdir() if p.is_dir()):
    files = list(d.glob("*.txt"))
    print(f"  {d.name}: {len(files)} files, {sum(f.stat().st_size for f in files) / 1e6:.1f} MB")
PY
