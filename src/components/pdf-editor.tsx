import React, { useState, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { 
  Save, Type, Upload, Eraser, MousePointer2, 
  Sparkles, X 
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { modifyPdf, type PdfAnnotation } from "@/lib/pdf-utils";

// Initialize PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const API_BASE = import.meta.env.PROD ? "/api" : "http://localhost:8787/api";
const WS_BASE = import.meta.env.PROD ? "wss://" + window.location.host + "/api" : "ws://localhost:8787/api";

export function PdfEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  
  const [tool, setTool] = useState<"none" | "text" | "erase">("none");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiStatus, setAiStatus] = useState<"idle" | "thinking">("idle");

  const transformRef = useRef<any>(null);

  // Upload and Initialize Session
  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      
      const fd = new FormData();
      fd.append("file", f);
      
      try {
        const res = await fetch(`${API_BASE}/session/upload`, { method: "POST", body: fd });
        if (!res.ok) throw new Error("Upload failed");
        
        const data = await res.json();
        setFile(f);
        setSessionId(data.id);
        connectWs(data.id);
      } catch (err) {
        console.error("Upload Error:", err);
        alert("Failed to upload PDF");
      }
    }
  };

  const connectWs = (id: string) => {
    if (ws) ws.close();
    const socket = new WebSocket(`${WS_BASE}/session/ws?id=${id}`);
    
    socket.onopen = () => console.log("Connected to Session");
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "sync-annotations") setAnnotations(msg.annotations);
      if (msg.type === "ai-status") setAiStatus(msg.status);
      if (msg.type === "ai-result") {
        setAiSummary(msg.text);
        setAiStatus("idle");
      }
    };
    setWs(socket);
  };

  const handlePageTap = (e: React.MouseEvent | React.TouchEvent, pageIndex: number) => {
    if (tool === "none") return;
    
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (tool === "text") {
       const text = prompt("Enter text:");
       if (text) {
         const newAnn: PdfAnnotation = {
           id: uuidv4(), type: "text", page: pageIndex + 1, x, y, text
         };
         const newSet = [...annotations, newAnn];
         setAnnotations(newSet);
         ws?.send(JSON.stringify({ type: "sync-annotations", annotations: newSet }));
       }
    } else if (tool === "erase") {
         const newAnn: PdfAnnotation = {
           id: uuidv4(), type: "rect", page: pageIndex + 1, x: x - 25, y: y - 10, width: 50, height: 20, color: "white"
         };
         const newSet = [...annotations, newAnn];
         setAnnotations(newSet);
         ws?.send(JSON.stringify({ type: "sync-annotations", annotations: newSet }));
    }
    setTool("none");
  };

  const triggerAi = () => {
    if(!ws) return;
    setAiStatus("thinking");
    ws.send(JSON.stringify({ type: "ai-summarize" }));
  };

  const downloadPdf = async () => {
    if(!file) return;
    const modifiedBytes = await modifyPdf(file, annotations);
    const blob = new Blob([modifiedBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "edited_" + file.name;
    link.click();
    
    // Optional: Save back to server
    if (sessionId) {
        const fd = new FormData();
        fd.append("file", blob, "edited_" + file.name);
        fetch(`${API_BASE}/session/save-changes?id=${sessionId}`, { method: "POST", body: fd });
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-100 overflow-hidden flex flex-col relative">
      {/* Header / Dynamic Island */}
      <div className="absolute top-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
        <div className="bg-black/80 backdrop-blur-md text-white rounded-full px-6 py-2 shadow-2xl pointer-events-auto flex items-center gap-4 transition-all">
           <span className="font-bold text-sm tracking-wide">Cloudflare PDF</span>
           {aiStatus === "thinking" && (
             <span className="text-xs bg-purple-600 px-2 py-0.5 rounded-full animate-pulse flex items-center gap-1">
               <Sparkles className="w-3 h-3" /> Thinking...
             </span>
           )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative z-0">
        {!file ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center">
            <div className="w-20 h-20 bg-blue-100 rounded-3xl flex items-center justify-center mb-6 text-blue-600">
               <Upload className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Tap to Upload</h2>
            <Button size="lg" className="rounded-full px-8 h-12 text-lg shadow-lg relative mt-6 cursor-pointer">
              <input type="file" accept="application/pdf" className="absolute inset-0 opacity-0 cursor-pointer" onChange={uploadFile} />
              Select PDF
            </Button>
          </div>
        ) : (
          <TransformWrapper
            ref={transformRef}
            initialScale={1}
            minScale={0.5}
            maxScale={4}
            centerOnInit
            disabled={tool !== "none"} 
          >
            <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full">
              <div className="w-full min-h-full flex flex-col items-center py-20 gap-4">
                 <Document file={file} onLoadSuccess={({ numPages }) => setNumPages(numPages)}>
                    {Array.from(new Array(numPages), (_, i) => (
                      <div 
                        key={i} 
                        className="relative shadow-2xl"
                        onClick={(e) => handlePageTap(e, i)}
                      >
                         <Page 
                           pageNumber={i + 1} 
                           width={window.innerWidth > 768 ? 600 : window.innerWidth * 0.9} 
                           renderTextLayer={false}
                           renderAnnotationLayer={false}
                         />
                         {annotations.filter(a => a.page === i + 1).map(ann => (
                           <div 
                             key={ann.id}
                             className="absolute pointer-events-none whitespace-pre"
                             style={{
                               left: ann.x, top: ann.y,
                               ...(ann.type === "rect" ? { 
                                 width: ann.width, height: ann.height, backgroundColor: ann.color 
                               } : { 
                                 fontSize: "16px", color: "black", fontWeight: "bold",
                                 textShadow: "0px 0px 2px white"
                               })
                             }}
                           >
                             {ann.type === "text" ? ann.text : null}
                           </div>
                         ))}
                      </div>
                    ))}
                 </Document>
              </div>
            </TransformComponent>
          </TransformWrapper>
        )}
      </div>

      {/* Toolbar */}
      {file && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 z-50">
           <div className="bg-white rounded-full shadow-xl border p-1.5 flex items-center gap-1">
              <Button variant={tool === "none" ? "default" : "ghost"} size="icon" className="rounded-full w-12 h-12" onClick={() => setTool("none")}>
                <MousePointer2 className="w-5 h-5" />
              </Button>
              <Button variant={tool === "text" ? "default" : "ghost"} size="icon" className="rounded-full w-12 h-12" onClick={() => setTool("text")}>
                <Type className="w-5 h-5" />
              </Button>
              <Button variant={tool === "erase" ? "default" : "ghost"} size="icon" className="rounded-full w-12 h-12" onClick={() => setTool("erase")}>
                <Eraser className="w-5 h-5" />
              </Button>
           </div>

           <div className="bg-white rounded-full shadow-xl border p-1.5 flex items-center gap-1">
             <Button variant="outline" size="icon" className="rounded-full w-12 h-12 text-purple-600 bg-purple-50" onClick={triggerAi}>
                <Sparkles className="w-5 h-5" />
              </Button>
              <Button variant="default" size="icon" className="rounded-full w-12 h-12 bg-black text-white hover:bg-slate-800" onClick={downloadPdf}>
                <Save className="w-5 h-5" />
              </Button>
           </div>
        </div>
      )}

      {/* AI Modal */}
      {aiSummary && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <Card className="w-full max-w-lg p-6 relative max-h-[80vh] overflow-y-auto">
            <Button variant="ghost" size="icon" className="absolute top-2 right-2" onClick={() => setAiSummary("")}>
              <X className="w-4 h-4" />
            </Button>
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-purple-700">
              <Sparkles className="w-5 h-5" /> Document Summary
            </h3>
            <div className="text-slate-700 leading-relaxed whitespace-pre-wrap font-mono text-sm">
              {aiSummary}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
