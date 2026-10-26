"""Build SOW.docx from SOW.md.

Re-runnable: overwrites SOW.docx in the same folder.
Edit SOW.md, then re-run this script — never edit the .docx directly.
"""
import re
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = Path(__file__).parent
SRC = HERE / "SOW.md"
OUT = HERE / "SOW.docx"

NAVY = RGBColor(0x0B, 0x1E, 0x3A)   # --bg-sidebar
ACCENT = RGBColor(0xC8, 0x10, 0x2E)  # --color-accent

# **bold**, `code`, *italic*  — code first so `engg_user_*` isn't mis-parsed
INLINE_RE = re.compile(
    r"\*\*(?!\s)(?P<bold>.+?)\*\*"
    r"|`(?P<code>[^`]+)`"
    r"|\*(?!\s)(?P<ital>[^*]+?)\*"
)


def add_inline(paragraph, text):
    """Render inline markdown into runs on an existing paragraph."""
    pos = 0
    for m in INLINE_RE.finditer(text):
        if m.start() > pos:
            paragraph.add_run(text[pos:m.start()])
        if m.group("bold") is not None:
            run = paragraph.add_run(m.group("bold"))
            run.bold = True
        elif m.group("code") is not None:
            run = paragraph.add_run(m.group("code"))
            run.font.name = "Consolas"
            run.font.size = Pt(9.5)
            run.font.color.rgb = RGBColor(0x8B, 0x1A, 0x1A)
        else:
            run = paragraph.add_run(m.group("ital"))
            run.italic = True
        pos = m.end()
    if pos < len(text):
        paragraph.add_run(text[pos:])


def shade(paragraph, hex_fill):
    el = OxmlElement("w:shd")
    el.set(qn("w:val"), "clear")
    el.set(qn("w:fill"), hex_fill)
    paragraph._p.get_or_add_pPr().append(el)


def add_code_block(doc, lines):
    """Monospace, shaded, single-cell look for a fenced block."""
    for i, line in enumerate(lines):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent = Cm(0.5)
        pf.space_before = Pt(6 if i == 0 else 0)
        pf.space_after = Pt(6 if i == len(lines) - 1 else 0)
        pf.line_spacing = 1.0
        run = p.add_run(line if line.strip() else "")
        run.font.name = "Consolas"
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)
        shade(p, "F3F4F6")


def parse_table(lines):
    """Return (header_row, body_rows) from a markdown table block."""
    rows = []
    for line in lines:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
            continue  # separator row
        rows.append(cells)
    return (rows[0] if rows else []), rows[1:]


def clear_para(p):
    """Drop the empty run python-docx leaves behind when setting cell.text."""
    for run in list(p.runs):
        run._element.getparent().remove(run._element)


def add_table(doc, header, rows):
    if not header:
        return
    table = doc.add_table(rows=1, cols=len(header))
    table.style = "Light Grid Accent 1"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for cell, text in zip(table.rows[0].cells, header):
        p = cell.paragraphs[0]
        clear_para(p)
        add_inline(p, text)
        for run in p.runs:
            run.bold = True
    for row in rows:
        cells = table.add_row().cells
        for cell, text in zip(cells, row):
            p = cell.paragraphs[0]
            clear_para(p)
            add_inline(p, text)
    for row in table.rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.space_after = Pt(2)
                for run in p.runs:
                    if run.font.name != "Consolas":
                        run.font.size = Pt(9.5)
    doc.add_paragraph()


def style_document(doc):
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.08

    for name, size, color in (
        ("Title", 24, NAVY),
        ("Heading 1", 15, NAVY),
        ("Heading 2", 12.5, ACCENT),
        ("Heading 3", 11, NAVY),
    ):
        st = doc.styles[name]
        st.font.name = "Calibri"
        st.font.size = Pt(size)
        st.font.color.rgb = color
        st.font.bold = True

    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    for attr in ("left_margin", "right_margin"):
        setattr(section, attr, Cm(2.0))
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.8)


def add_footer(doc, text):
    footer = doc.sections[0].footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(f"{text}   |   Page ")
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor(0x6B, 0x72, 0x80)

    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    p._p.append(fld)


def main():
    lines = SRC.read_text(encoding="utf-8").splitlines()

    doc = Document()
    style_document(doc)
    add_footer(doc, "SOW-POC-ENGG-INTRANET-001 v1.0")

    i = 0
    in_code = False
    code_lines = []
    first_heading = True

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # ---- fenced code block -------------------------------------------
        if stripped.startswith("```"):
            if in_code:
                add_code_block(doc, code_lines)
                code_lines = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue
        if in_code:
            code_lines.append(line)
            i += 1
            continue

        # ---- blank / horizontal rule -------------------------------------
        if not stripped:
            i += 1
            continue
        if re.fullmatch(r"-{3,}", stripped):
            i += 1
            continue

        # ---- table --------------------------------------------------------
        if stripped.startswith("|"):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            header, rows = parse_table(block)
            add_table(doc, header, rows)
            continue

        # ---- headings ------------------------------------------------------
        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            level, text = len(m.group(1)), m.group(2)
            if first_heading and level == 1:
                p = doc.add_paragraph(style="Title")
                add_inline(p, text)
                first_heading = False
            else:
                h = doc.add_heading(level=min(level - 1, 3))
                add_inline(h, text)
            i += 1
            continue

        # ---- bullets (supports 2-level nesting) ----------------------------
        m = re.match(r"^(\s*)[-*]\s+(.*)$", line)
        if m:
            indent = len(m.group(1))
            level = "List Bullet" if indent < 2 else "List Bullet 2"
            p = doc.add_paragraph(style=level)
            p.paragraph_format.space_after = Pt(3)
            add_inline(p, m.group(2))
            i += 1
            continue

        # ---- numbered list --------------------------------------------------
        m = re.match(r"^(\s*)(\d+)\.\s+(.*)$", line)
        if m:
            p = doc.add_paragraph(style="List Number")
            p.paragraph_format.space_after = Pt(3)
            add_inline(p, m.group(3))
            i += 1
            continue

        # ---- plain paragraph -------------------------------------------------
        p = doc.add_paragraph()
        add_inline(p, stripped)
        i += 1

    if in_code and code_lines:
        add_code_block(doc, code_lines)

    doc.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
