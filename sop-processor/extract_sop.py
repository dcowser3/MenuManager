import fitz  # PyMuPDF
import os

def extract_text_from_pdf(pdf_path="company_sop.pdf", output_txt_path="sop_raw_text.txt"):
    """
    Extracts text from a given PDF and saves it to a text file.
    """
    if not os.path.exists(pdf_path):
        print(f"❌ Error: The file '{pdf_path}' was not found.")
        print("Please place your SOP PDF in the 'sop-processor' directory and name it 'company_sop.pdf'.")
        return

    try:
        doc = fitz.open(pdf_path)
        full_text = ""
        for page in doc:
            full_text += page.get_text()

        with open(output_txt_path, "w", encoding="utf-8") as f:
            f.write(full_text)

        print(f"✅ Successfully extracted text from '{pdf_path}' to '{output_txt_path}'")
    except Exception as e:
        print(f"❌ Error during PDF extraction: {e}")

if __name__ == "__main__":
    extract_text_from_pdf()
