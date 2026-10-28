import sys
import json
import zipfile
import xml.etree.ElementTree as ET

def extract_docx(filepath):
    try:
        with zipfile.ZipFile(filepath, 'r') as z:
            xml_content = z.read('word/document.xml')

        tree = ET.fromstring(xml_content)
        # XML namespaces in Word
        namespaces = {
            'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
            'w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
            'wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
        }

        paragraphs = []
        for p in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
            texts = [node.text for node in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t') if node.text]
            if texts:
                paragraphs.append(''.join(texts))

        full_text = '\n'.join(paragraphs)

        output = {
            "success": True,
            "pages": 1, # Word docs don't store strict page boundaries
            "totalChars": len(full_text.strip()),
            "isScanned": False,
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
        extract_docx(sys.argv[1])
    else:
        print(json.dumps({"success": False, "error": "No file path provided"}))
