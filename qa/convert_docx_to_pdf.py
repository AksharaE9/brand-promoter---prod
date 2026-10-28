import os
import win32com.client

def convert_to_pdf(docx_path, pdf_path):
    word = win32com.client.Dispatch('Word.Application')
    word.Visible = False
    try:
        doc = word.Documents.Open(docx_path)
        # wdFormatPDF = 17
        doc.SaveAs(pdf_path, FileFormat=17)
        doc.Close()
        print(f"Successfully converted {docx_path} to {pdf_path}")
    except Exception as e:
        print(f"Error during Word PDF conversion: {e}")
        raise e
    finally:
        word.Quit()

if __name__ == '__main__':
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'reports'))
    docx_file = os.path.join(base_dir, 'EXECUTIVE-READOUT-FOR-LEADERSHIP.docx')
    pdf_file = os.path.join(base_dir, 'EXECUTIVE-READOUT-FOR-LEADERSHIP.pdf')
    convert_to_pdf(docx_file, pdf_file)
