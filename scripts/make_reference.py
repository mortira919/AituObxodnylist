"""Build docs/ref.docx: pandoc's default reference restyled as one plain report style.

Times New Roman everywhere, 14 pt text and headings, 12 pt in tables, single line spacing,
first-line indent 1.25 cm, A4 with margins 30/15/20/20 mm, black only.
"""
import os, re, subprocess, sys, zipfile

out = sys.argv[1] if len(sys.argv) > 1 else "docs/ref.docx"
FONT = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>'
INDENT = 709  # 1.25 cm
LINE = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'

def sz(pt):
    return [f'<w:sz w:val="{pt * 2}"/>', f'<w:szCs w:val="{pt * 2}"/>']

def heading(before, after, page_break=False):
    p = ['<w:keepNext/>', '<w:keepLines/>', f'<w:spacing w:before="{before}" w:after="{after}" w:line="276" w:lineRule="auto"/>',
         '<w:jc w:val="left"/>', f'<w:ind w:firstLine="{INDENT}"/>']
    return (p + (['<w:pageBreakBefore/>'] if page_break else []), ['<w:b/>', '<w:i w:val="0"/>', '<w:caps w:val="0"/>'] + sz(14))

# styleId -> (pPr elements, rPr elements); an element replaces any existing element with the same tag.
STYLES = {
    "Normal": ([LINE], sz(14)),
    "BodyText": ([LINE, '<w:jc w:val="both"/>', f'<w:ind w:firstLine="{INDENT}"/>'], sz(14)),
    "FirstParagraph": ([LINE, '<w:jc w:val="both"/>', f'<w:ind w:firstLine="{INDENT}"/>'], sz(14)),
    "Heading1": heading(240, 240),
    "Heading2": heading(240, 120),
    "Heading3": heading(240, 120),
    "TOCHeading": (['<w:pageBreakBefore/>', '<w:jc w:val="center"/>', '<w:ind w:firstLine="0"/>',
                    '<w:spacing w:before="0" w:after="240"/>', '<w:outlineLvl w:val="9"/>'], ['<w:b/>'] + sz(14)),
    "Title": (['<w:jc w:val="center"/>', '<w:ind w:firstLine="0"/>', '<w:spacing w:before="4000" w:after="240" w:line="276" w:lineRule="auto"/>'], ['<w:b/>', '<w:spacing w:val="0"/>'] + sz(16)),
    "Subtitle": (['<w:jc w:val="center"/>', '<w:ind w:firstLine="0"/>', '<w:spacing w:before="0" w:after="2400" w:line="276" w:lineRule="auto"/>'], ['<w:b w:val="0"/>', '<w:i w:val="0"/>', '<w:spacing w:val="0"/>'] + sz(14)),
    "Author": (['<w:jc w:val="center"/>', '<w:ind w:firstLine="0"/>'], sz(14)),
    "Date": (['<w:jc w:val="center"/>', '<w:ind w:firstLine="0"/>', '<w:spacing w:before="3600" w:after="0"/>'], sz(14)),
    "Compact": (['<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>', '<w:jc w:val="left"/>', '<w:ind w:firstLine="0"/>'], sz(12)),
    "CaptionedFigure": (['<w:jc w:val="center"/>', '<w:ind w:firstLine="0"/>', '<w:spacing w:before="240" w:after="0"/>', '<w:keepNext/>'], []),
    "Figure": (['<w:jc w:val="center"/>', '<w:ind w:firstLine="0"/>'], []),
    "ImageCaption": (['<w:jc w:val="center"/>', '<w:ind w:firstLine="0"/>', '<w:spacing w:before="120" w:after="240"/>'], ['<w:i w:val="0"/>'] + sz(14)),
    "VerbatimChar": ([], [FONT, '<w:sz w:val="0"/>']),  # size removed below: inherits the paragraph size
    "Hyperlink": ([], ['<w:u w:val="none"/>']),
}

# Styles pandoc needs that the default reference lacks.
NEW = {
    "ListBody": ("List Body", "BodyText", ([LINE, '<w:jc w:val="both"/>', '<w:ind w:firstLine="0"/>'], sz(14))),
    "SourceCode": ("Source Code", "Normal", (['<w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/>', '<w:jc w:val="left"/>', f'<w:ind w:left="{INDENT}" w:firstLine="0"/>'], sz(12))),
    "TOC1": ("toc 1", "Normal", ([LINE, '<w:ind w:left="0" w:firstLine="0"/>', '<w:jc w:val="left"/>'], sz(14))),
    "TOC2": ("toc 2", "Normal", ([LINE, '<w:ind w:left="280" w:firstLine="0"/>', '<w:jc w:val="left"/>'], sz(14))),
}

BORDERS = ('<w:tblBorders>' + ''.join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
           for s in ("top", "left", "bottom", "right", "insideH", "insideV")) + '</w:tblBorders>')

def tag(el):
    return re.match(r'<(w:\w+)', el).group(1)

def put(block, container, elements):
    if not elements:
        return block
    if not re.search(rf'<{container}[ >/]', block):
        block = block.replace('</w:style>', f'<{container}></{container}></w:style>')
    block = re.sub(rf'<{container}\s*/>', f'<{container}></{container}>', block)
    def edit(m):
        inner = m.group(2)
        for el in elements:
            inner = re.sub(rf'<{tag(el)}(\s[^>]*)?/>', '', inner)
            inner = re.sub(rf'<{tag(el)}(\s[^>]*)?>.*?</{tag(el)}>', '', inner, flags=re.S)
            inner = el + inner
        return m.group(1) + inner + m.group(3)
    return re.sub(rf'(<{container}>)(.*?)(</{container}>)', edit, block, count=1, flags=re.S)

def style_xml(xml):
    xml = re.sub(r'<w:color [^>]*/>', '<w:color w:val="000000"/>', xml)
    xml = re.sub(r'<w:rFonts [^>]*/>', FONT, xml)
    xml = re.sub(r'<w:docDefaults>.*?</w:docDefaults>',
                 '<w:docDefaults><w:rPrDefault><w:rPr>' + FONT + ''.join(sz(14)) + '<w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>'
                 '<w:pPrDefault><w:pPr>' + LINE + '</w:pPr></w:pPrDefault></w:docDefaults>', xml, count=1, flags=re.S)
    for sid, (name, based, _) in NEW.items():
        if f'w:styleId="{sid}"' not in xml:
            xml = xml.replace('</w:styles>', f'<w:style w:type="paragraph" w:customStyle="1" w:styleId="{sid}"><w:name w:val="{name}"/>'
                              f'<w:basedOn w:val="{based}"/><w:qFormat/></w:style></w:styles>')
    rules = {**STYLES, **{k: v[2] for k, v in NEW.items()}}
    def fix(m):
        block, sid = m.group(0), m.group(1)
        if sid in rules:
            block = put(block, 'w:pPr', rules[sid][0]) if 'w:type="paragraph"' in block else block
            block = put(block, 'w:rPr', rules[sid][1])
        if sid == "VerbatimChar":
            block = re.sub(r'<w:sz(Cs)? w:val="0"/>', '', block)
        if sid == "Table":
            block = block.replace('<w:tblPr>', '<w:tblPr>' + BORDERS, 1)
        return block
    return re.sub(r'<w:style [^>]*w:styleId="([^"]+)".*?</w:style>', fix, xml, flags=re.S)

def doc_xml(xml):
    sect = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1134" w:right="851" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/>'
            '</w:sectPr>')
    return re.sub(r'<w:sectPr>.*?</w:sectPr>', sect, xml, flags=re.S)

src = subprocess.run(["pandoc", "--print-default-data-file", "reference.docx"], capture_output=True, check=True).stdout
tmp = out + ".src"
with open(tmp, "wb") as f:
    f.write(src)
with zipfile.ZipFile(tmp) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "word/styles.xml":
            data = style_xml(data.decode()).encode()
        elif item.filename == "word/document.xml":
            data = doc_xml(data.decode()).encode()
        zout.writestr(item, data)
os.remove(tmp)
