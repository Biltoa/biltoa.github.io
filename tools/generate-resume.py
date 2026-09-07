"""Insert the NAV MCP bullet into the original resume without reflowing it."""

from io import BytesIO
from pathlib import Path
import shutil

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, FloatObject
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "compare" / "pre-optimization" / "public" / "Ahmad-Bilto-Resume.pdf"
OUTPUT = ROOT / "output" / "pdf" / "Ahmad-Bilto-Resume.pdf"
PUBLIC = ROOT / "public" / "Ahmad-Bilto-Resume.pdf"

# The source is fixed-position 10 pt Carlito with 11.45 pt leading. The new
# bullet is three lines, so every untouched operator that followed the first
# independent-development bullet moves down exactly three lines plus the
# existing 3.1 pt inter-bullet gap. Nothing is reflowed or rebuilt.
SHIFT = 37.45
FIRST_BASELINE = 256.05
LEADING = 11.45
TEXT_X = 49.05
BULLET_X = 38.30

LINES = [
    "Built NAV MCP, an external .NET 8 server and desktop app that lets AI tools control multiple Unity Editors through 92",
    "operations exposed as six MCP tools, cutting idle tool-schema context from 56,800 to 910 tokens; added one-tick",
    "batching, ~1 ms scene reads, permissions, and 153 automated tests.",
]


def shift_untouched_lower_content(page, reader):
    """Translate the original second independent bullet and everything below."""
    content = ContentStream(page.get_contents(), reader)
    found_anchor = False
    for operands, operator in content.operations:
        if operator == b"Td" and len(operands) == 2:
            x, y = map(float, operands)
            if abs(x - BULLET_X) < 0.01 and abs(y - FIRST_BASELINE) < 0.01:
                found_anchor = True
            if y <= FIRST_BASELINE + 0.01:
                operands[1] = FloatObject(y - SHIFT)
        elif operator in (b"m", b"l") and len(operands) == 2:
            # The Education rule is emitted after every text object in the
            # source stream, so it cannot share one global transform with the
            # lower text. Shift only rules physically below the insertion.
            x, y = map(float, operands)
            if y <= FIRST_BASELINE + 0.01:
                operands[1] = FloatObject(y - SHIFT)

    if not found_anchor:
        raise RuntimeError("Could not locate the original second independent-development bullet")
    page.replace_contents(content)


def make_bullet_overlay():
    """Draw only the added bullet, using Calibri's Carlito-compatible metrics."""
    stream = BytesIO()
    pdfmetrics.registerFont(TTFont("ResumeCalibri", r"C:\Windows\Fonts\calibri.ttf"))
    layer = canvas.Canvas(stream, pagesize=letter)
    layer.setFillColorRGB(0, 0, 0)
    layer.setFont("ResumeCalibri", 10)
    layer.drawString(BULLET_X, FIRST_BASELINE, "•")
    for index, line in enumerate(LINES):
        layer.drawString(TEXT_X, FIRST_BASELINE - index * LEADING, line)
    layer.save()
    stream.seek(0)
    return PdfReader(stream).pages[0]


def build():
    reader = PdfReader(SOURCE)
    if len(reader.pages) != 1:
        raise RuntimeError("The source resume is no longer one page")

    # Attach the cloned source page before replacing its content stream. Pypdf
    # otherwise accepts the call but can discard the replacement when that
    # detached page is cloned into a writer later.
    writer = PdfWriter()
    page = writer.add_page(reader.pages[0])
    shift_untouched_lower_content(page, writer)
    page.merge_page(make_bullet_overlay(), over=True)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    writer.add_metadata(
        {
            "/Title": "Ahmad Bilto - Unity Gameplay & Tools Developer",
            "/Author": "Ahmad Bilto",
            "/Subject": "Resume",
        }
    )
    with OUTPUT.open("wb") as target:
        writer.write(target)

    shutil.copyfile(OUTPUT, PUBLIC)
    print(OUTPUT)
    print(PUBLIC)


if __name__ == "__main__":
    build()
