#!/usr/bin/env bash
# Сборка документов: docs/*.md -> output/*.docx (+ PDF для проверки).
#   obhodnoy_list_documentation — основная документация, оглавление с номерами страниц (два прохода);
#   qa_zashita — вопросы и ответы для защиты, без оглавления.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

python3 scripts/make_reference.py docs/ref.docx
for f in docs/img/*.svg; do rsvg-convert -z 2 "$f" -o "${f%.svg}.png"; done

# build NAME SOURCE_MD
build() {
  pandoc "$2" --resource-path=docs --reference-doc=docs/ref.docx -o "output/$1.docx"
  python3 scripts/postprocess_docx.py "output/$1.docx"
  (cd output && soffice --headless --convert-to pdf "$1.docx" >/dev/null 2>&1)
  echo "$1: $(pdfinfo "output/$1.pdf" | awk '/Pages/ {print $2}') стр."
}

MAIN=docs/obhodnoy_list_documentation.md
python3 scripts/toc.py render "$MAIN" > "$TMP/main.md"
build obhodnoy_list_documentation "$TMP/main.md" >/dev/null
python3 scripts/toc.py pages "$MAIN" output/obhodnoy_list_documentation.pdf > "$TMP/pages.json"
python3 scripts/toc.py render "$MAIN" "$TMP/pages.json" > "$TMP/main.md"
build obhodnoy_list_documentation "$TMP/main.md"
python3 scripts/toc.py pages "$MAIN" output/obhodnoy_list_documentation.pdf | cmp -s - "$TMP/pages.json" \
  || echo "Внимание: номера страниц сдвинулись после второго прохода" >&2

build qa_zashita docs/qa_zashita.md
