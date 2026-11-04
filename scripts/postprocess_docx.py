"""Finish pandoc's docx: lists get the body style, tables get borders and a bold header row,
list markers line up with the paragraph indent, page numbers in the footer."""
import re, sys, zipfile, os

path = sys.argv[1]
INDENT, HANG = 709, 425
FONT = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>'
BORDERS = ('<w:tblBorders>' + ''.join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
           for s in ("top", "left", "bottom", "right", "insideH", "insideV")) + '</w:tblBorders>')

def bold_runs(row):
    row = re.sub(r'<w:r>(?!<w:rPr>)', '<w:r><w:rPr><w:b/></w:rPr>', row)
    return re.sub(r'<w:r><w:rPr>(?!<w:b/>)', '<w:r><w:rPr><w:b/>', row)

def table(m):
    t = m.group(0)
    t = re.sub(r'<w:tblBorders>.*?</w:tblBorders>', '', t, flags=re.S)
    t = re.sub(r'(<w:tblPr>)', r'\1' + BORDERS, t, count=1)
    t = re.sub(r'<w:tblCellMar>.*?</w:tblCellMar>', '', t, flags=re.S)
    t = t.replace('</w:tblPr>', '<w:tblCellMar><w:top w:w="28" w:type="dxa"/><w:left w:w="85" w:type="dxa"/>'
                  '<w:bottom w:w="28" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr>', 1)
    t = re.sub(r'<w:tr>.*?</w:tr>|<w:tr .*?</w:tr>', lambda r: bold_runs(r.group(0)), t, count=1, flags=re.S)
    # Rows never split across pages; the header row repeats on every page.
    t = re.sub(r'<w:trPr>.*?</w:trPr>', '', t, flags=re.S)
    t = re.sub(r'<w:tr( [^>]*)?>', lambda r: r.group(0) + '<w:trPr><w:cantSplit/></w:trPr>', t)
    t = t.replace('<w:trPr><w:cantSplit/></w:trPr>', '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>', 1)
    return t

def keep_with_next(p):
    """A paragraph that introduces a list or table (ends with ':') stays on the page with it."""
    texts = re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', p)
    if not texts or not ''.join(texts).rstrip().endswith(':') or '<w:keepNext/>' in p:
        return p
    if '<w:pPr>' in p:
        return p.replace('<w:pPr>', '<w:pPr><w:keepNext/>', 1)
    return re.sub(r'(<w:p(?: [^>]*)?>)', r'\1<w:pPr><w:keepNext/></w:pPr>', p, count=1)

def document(xml):
    parts = re.split(r'(<w:tbl>.*?</w:tbl>)', xml, flags=re.S)
    parts = [p if p.startswith('<w:tbl>') else p.replace('<w:pStyle w:val="Compact" />', '<w:pStyle w:val="ListBody" />')
             .replace('<w:pStyle w:val="Compact"/>', '<w:pStyle w:val="ListBody"/>') for p in parts]
    parts = [p if p.startswith('<w:tbl>') else re.sub(r'<w:p(?: [^>]*)?>.*?</w:p>', lambda m: keep_with_next(m.group(0)), p, flags=re.S)
             for p in parts]
    xml = ''.join(parts)
    xml = re.sub(r'<w:tbl>.*?</w:tbl>', table, xml, flags=re.S)
    # A 6 pt gap before and after every table.
    gap = '<w:p><w:pPr>{}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:rPr><w:sz w:val="12"/></w:rPr></w:pPr></w:p>'
    xml = xml.replace('<w:tbl>', gap.format('<w:keepNext/>') + '<w:tbl>').replace('</w:tbl>', '</w:tbl>' + gap.format(''))
    # With a table of contents, section 1 starts on a new page after it.
    if 'w:val="TOCHeading"' in xml:
        xml = re.sub(r'(<w:pStyle w:val="Heading1"\s*/>)', r'\1<w:pageBreakBefore/>', xml, count=1)
    # Page number footer.
    return re.sub(r'<w:sectPr>', '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooterPN"/><w:titlePg/>', xml, count=1) \
        if 'rIdFooterPN' not in xml else xml

def numbering(xml):
    def lvl(m):
        block, i = m.group(0), int(m.group(1))
        left = INDENT + HANG + i * HANG
        block = re.sub(r'<w:ind [^>]*/>', f'<w:ind w:left="{left}" w:hanging="{HANG}"/>', block)
        if 'w:val="bullet"' in block:
            block = re.sub(r'<w:lvlText w:val="[^"]*"\s*/>', '<w:lvlText w:val="–"/>', block)
        block = re.sub(r'<w:rPr>.*?</w:rPr>', '', block, flags=re.S)
        return block.replace('</w:lvl>', f'<w:rPr>{FONT}</w:rPr></w:lvl>')
    return re.sub(r'<w:lvl w:ilvl="(\d)".*?</w:lvl>', lvl, xml, flags=re.S)

FOOTER = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
          '<w:p><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr>'
          '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>')

tmp = path + ".tmp"
with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "word/document.xml":
            data = document(data.decode()).encode()
        elif item.filename == "word/numbering.xml":
            data = numbering(data.decode()).encode()
        elif item.filename == "word/_rels/document.xml.rels":
            data = data.decode().replace('</Relationships>',
                '<Relationship Id="rIdFooterPN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footerPN.xml"/></Relationships>').encode()
        elif item.filename == "[Content_Types].xml":
            data = data.decode().replace('</Types>',
                '<Override PartName="/word/footerPN.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>').encode()
        zout.writestr(item, data)
    zout.writestr("word/footerPN.xml", FOOTER)
os.replace(tmp, path)
