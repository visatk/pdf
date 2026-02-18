import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface PdfAnnotation {
  id: string;
  type: "text" | "rect";
  page: number; // 1-based index
  x: number;
  y: number;
  text?: string;
  width?: number;
  height?: number;
  color?: string;
}

export async function modifyPdf(
  file: File, 
  annotations: PdfAnnotation[]
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    if (ann.page > pages.length) continue;
    const page = pages[ann.page - 1];
    const { height } = page.getSize();

    // PDF coordinates start at bottom-left. Browser DOM starts top-left.
    // We must flip the Y axis: pdfY = height - domY.

    if (ann.type === "text" && ann.text) {
      page.drawText(ann.text, {
        x: ann.x,
        y: height - ann.y, 
        size: 12,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });
    }

    if (ann.type === "rect" && ann.width && ann.height) {
      page.drawRectangle({
        x: ann.x,
        y: height - ann.y - ann.height, // Adjust for bottom-left origin
        width: ann.width,
        height: ann.height,
        color: rgb(1, 1, 0), // Yellow
        opacity: 0.4,
      });
    }
  }

  return await pdfDoc.save();
}
