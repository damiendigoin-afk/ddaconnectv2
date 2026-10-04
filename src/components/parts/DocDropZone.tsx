import { useRef, useState, type DragEvent } from "react";
import { Camera, Loader2, Paperclip, UploadCloud } from "lucide-react";

import { DOC_ACCEPT } from "@/lib/documents";

/**
 * Zone de dépôt standard du module Pièces & achats (commande, BL, facture, retour/avoir).
 * Glisser-déposer en premier ; sélection de fichier et photo en secours.
 * Formats : PDF natif ou scanné, image, photo, capture d'écran.
 */
export function DocDropZone({
  title,
  hint,
  busy,
  onFile,
  pickLabel = "Choisir un fichier",
}: {
  title: string;
  hint?: string;
  busy?: boolean;
  onFile: (file: File) => void | Promise<void>;
  pickLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function pick(camera: boolean) {
    const el = input.current;
    if (!el) return;
    if (camera) el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.accept = camera ? "image/*" : DOC_ACCEPT;
    el.click();
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !busy) void onFile(f);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      onPaste={(e) => { const f = e.clipboardData.files?.[0]; if (f && !busy) void onFile(f); }}
      className={`rounded-2xl border-2 border-dashed p-5 text-center transition ${over ? "border-brand bg-brand/10" : "border-border bg-card"}`}
      data-testid="doc-dropzone"
    >
      {busy ? <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand" /> : <UploadCloud className="mx-auto h-10 w-10 text-brand" />}
      <p className="mt-2 text-sm font-extrabold uppercase tracking-wide">{busy ? "Lecture du document…" : title}</p>
      <p className="text-xs text-muted-foreground">{hint ?? "Glissez-déposez ici un PDF, une photo ou une capture d'écran"}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => pick(false)} className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-border bg-background text-xs font-bold uppercase disabled:opacity-50">
          <Paperclip className="h-4 w-4" /> {pickLabel}
        </button>
        <button type="button" disabled={busy} onClick={() => pick(true)} className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-border bg-background text-xs font-bold uppercase disabled:opacity-50">
          <Camera className="h-4 w-4" /> Photo
        </button>
      </div>
      <input
        ref={input}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
    </div>
  );
}
