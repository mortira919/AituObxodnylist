"""Static table of contents with page numbers (renders in any viewer, unlike a Word TOC field).

render SRC [PAGES.json]  -> markdown with the TOC inserted before the first section
pages  SRC PDF           -> JSON {heading: page} read from the built PDF
"""
import json, re, subprocess, sys
from html import escape

WIDTH = 9354  # text width in twips: A4 minus 30 and 15 mm margins

def headings(src):
    body = open(src).read().split('\n---\n', 1)[1] if src else ''
    out, code = [], False
    for line in body.split('\n'):
        if line.startswith('```'):
            code = not code
        m = re.match(r'^(#{1,2}) (.+)$', line)
        if m and not code:
            out.append((len(m.group(1)), m.group(2).strip()))
    return out

def norm(s):
    return re.sub(r'\s+', ' ', s.replace('\u00ad', '')).strip()

def render(src, pages_json=None):
    pages = json.load(open(pages_json)) if pages_json else {}
    paras = ['<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Содержание</w:t></w:r></w:p>']
    for level, text in headings(src):
        page = pages.get(text, '00')
        paras.append(f'<w:p><w:pPr><w:pStyle w:val="TOC{level}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{WIDTH}"/></w:tabs></w:pPr>'
                     f'<w:r><w:t xml:space="preserve">{escape(text, quote=False)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>{page}</w:t></w:r></w:p>')
    toc = '```{=openxml}\n' + '\n'.join(paras) + '\n```\n'
    text = open(src).read()
    i = text.index('\n# ')
    return text[:i + 1] + '\n' + toc + text[i:]

def pages(src, pdf):
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
    texts = [norm(subprocess.run(['pdftotext', '-f', str(p), '-l', str(p), pdf, '-'], capture_output=True, text=True).stdout)
             for p in range(1, n + 1)]
    heads = headings(src)
    result = {}
    toc_end = max(p for p in range(n) if 'Содержание' in texts[p][:40]) if any('Содержание' in t[:40] for t in texts) else 0
    # The TOC itself lists every heading, so search only after it, in order.
    start = toc_end + 1
    for _, text in heads:
        key = norm(text)[:40]
        for p in range(start, n):
            if key in texts[p]:
                result[text] = p + 1
                start = p
                break
    return result

if __name__ == '__main__':
    if sys.argv[1] == 'render':
        sys.stdout.write(render(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
    else:
        json.dump(pages(sys.argv[2], sys.argv[3]), sys.stdout, ensure_ascii=False, indent=1)
