import sys
import json
import pypdf

def extract_pdf(filepath):
    try:
        reader = pypdf.PdfReader(filepath)
        page_count = len(reader.pages)
        pages_text = []
        total_chars = 0

        for i, page in enumerate(reader.pages):
            text = page.extract_text(extraction_mode="layout") or page.extract_text() or ""
            total_chars += len(text.strip())
            pages_text.append(text)

        full_text = "\n\n".join(pages_text)
        is_scanned = (total_chars / max(1, page_count)) < 200

        output = {
            "success": True,
            "pages": page_count,
            "totalChars": total_chars,
            "isScanned": is_scanned,
            "text": full_text
        }
    except Exception as e:
        output = {
            "success": False,
            "error": str(e),
            "pages": 0,
            "totalChars": 0,
            "isScanned": False,
            "text": ""
        }

    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(output, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        extract_pdf(sys.argv[1])
    else:
        print(json.dumps({"success": False, "error": "No file path provided"}))
