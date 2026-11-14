"""Text out of uploaded PDF and Word files. Plain text files are read by the Core ERP itself."""

import io

from docx import Document
from pypdf import PdfReader

MAX_PAGES = 1500


class ExtractError(ValueError):
    pass


def _pdf(content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(content))
    except Exception as err:  # pypdf raises several error types for broken files
        raise ExtractError(f"The PDF could not be opened: {err}") from err
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception as err:
            raise ExtractError("The PDF is password protected. Upload a copy without a password.") from err
    if len(reader.pages) > MAX_PAGES:
        raise ExtractError(f"The PDF has more than {MAX_PAGES} pages. Split it into smaller files.")
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n\n".join(pages)


def _docx(content: bytes) -> str:
    try:
        document = Document(io.BytesIO(content))
    except Exception as err:
        raise ExtractError(f"The Word file could not be opened: {err}") from err
    parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    # Tables often hold the facts people ask about (fees, timings), so each row becomes a line.
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append(" | ".join(dict.fromkeys(cells)))
    return "\n\n".join(parts)


READERS = {"pdf": _pdf, "docx": _docx}


def extract_text(file_name: str, content: bytes) -> str:
    extension = file_name.lower().rsplit(".", 1)[-1] if "." in file_name else ""
    reader = READERS.get(extension)
    if not reader:
        raise ExtractError(f"Files of type .{extension or '?'} are not read by the AI service.")
    return reader(content)
