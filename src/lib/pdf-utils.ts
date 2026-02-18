import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface PdfAnnotation {
  id: string;
  type: "text" | "rect" | "image" | "path";
  page: number; // 1-based index
  x: number;
  y: number;
  // Text specific
  text?: string;
  fontSize?: number;
  // Rect/Image specific
  width?: number;
  height?: number;
  // Image specific
  image?: string; // Base64 data
  // Path specific
  path?: string; // SVG Path data (d attribute)
  strokeWidth?: number;
  // Shared
  color?: string;
}

export async function modifyPdf(
  file: File, 
  annotations: PdfAnnotation[],
  deletedPageIndices: number[] = []
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  // 1. Apply Annotations
  const pages = pdfDoc.getPages();
  
  for (const ann of annotations) {
    // Skip if page was deleted or invalid
    if (ann.page > pages.length || deletedPageIndices.includes(ann.page - 1)) continue;
    
    const page = pages[ann.page - 1];
    const { height } = page.getSize();

    // Color helper
    const parseColor = (hex: string) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return rgb(isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b);
    }

    if (ann.type === "text" && ann.text) {
      page.drawText(ann.text, {
        x: ann.x,
        y: height - ann.y, 
        size: ann.fontSize || 12,
        font: helveticaFont,
        color: parseColor(ann.color || "#000000"),
      });
    }

    if (ann.type === "rect" && ann.width && ann.height) {
      page.drawRectangle({
        x: ann.x,
        y: height - ann.y - ann.height, 
        width: ann.width,
        height: ann.height,
        color: parseColor(ann.color || "#ffff00"), 
        opacity: 0.4,
      });
    }

    if (ann.type === "image" && ann.image && ann.width && ann.height) {
        try {
            const imgBytes = Uint8Array.from(atob(ann.image.split(',')[1]), c => c.charCodeAt(0));
            // Detect type roughly or try both
            const isPng = ann.image.startsWith("data:image/png");
            const embeddedImage = isPng 
                ? await pdfDoc.embedPng(imgBytes) 
                : await pdfDoc.embedJpg(imgBytes);
            
            page.drawImage(embeddedImage, {
                x: ann.x,
                y: height - ann.y - ann.height,
                width: ann.width,
                height: ann.height,
            });
        } catch(e) { console.error("Failed to embed image", e); }
    }

    if (ann.type === "path" && ann.path) {
        page.drawSvgPath(ann.path, {
            x: ann.x,
            y: height - ann.y,
            borderColor: parseColor(ann.color || "#000000"),
            borderWidth: ann.strokeWidth || 2,
        });
    }
  }

  // 2. Handle Page Deletion (Reverse order to maintain indices)
  const sortedDeletions = [...deletedPageIndices].sort((a, b) => b - a);
  for (const idx of sortedDeletions) {
      if (idx < pdfDoc.getPageCount()) {
          pdfDoc.removePage(idx);
      }
  }

  return await pdfDoc.save();
}
