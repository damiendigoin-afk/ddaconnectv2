import { useEffect, useRef, useState } from "react";
import { Camera, Images, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useLightbox } from "@/components/PhotoLightbox";
import { deleteMedia, mediaUrl, type MediaLinks } from "@/lib/photo";
import { prepareCapture, uploadCapture } from "@/lib/photo-capture";
import { addFailedUpload } from "@/lib/upload-tracker";

export type MediaRow = { id: string; storage_path: string };

export function MediaThumb({
  path,
  className,
  onClick,
}: {
  path: string;
  className?: string;
  onClick?: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    mediaUrl(path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [path]);
  return (
    <img
      src={url}
      alt="Photo du contrôle"
      loading="lazy"
      onClick={onClick}
      className={className ?? "h-20 w-20 rounded-lg object-cover"}
    />
  );
}

export function PhotoManager({
  folder,
  links,
  compact,
}: {
  folder: string;
  links: MediaLinks;
  compact?: boolean;
}) {
  const [items, setItems] = useState<MediaRow[]>([]);
  const [busy, setBusy] = useState(false);
  const lightbox = useLightbox();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const filterKey =
    links.inspection_point_id ?? links.observation_id ?? links.repair_order_id ?? links.inspection_id;
  const filterCol = links.inspection_point_id
    ? "inspection_point_id"
    : links.observation_id
      ? "observation_id"
      : links.repair_order_id
        ? "repair_order_id"
        : "inspection_id";

  useEffect(() => {
    if (!filterKey) return;
    let active = true;
    supabase
      .from("media")
      .select("id, storage_path")
      .eq(filterCol, filterKey)
      .order("created_at")
      .then(({ data }) => {
        if (active && data) setItems(data as MediaRow[]);
      });
    return () => {
      active = false;
    };
  }, [filterCol, filterKey]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await sendOne(file);
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Un échec d'envoi est mémorisé globalement : la clôture du Tour reste
   * bloquée tant que l'utilisateur n'a pas réessayé ou abandonné la photo.
   */
  async function sendOne(file: unknown) {
    // Chemin partagé, tolérant aux retours caméra Android incomplets :
    // aucune exception ne peut remonter au rendu de la carte.
    const res = await uploadCapture(file, folder, links);
    if (res.ok) {
      setItems((prev) => [...prev, res.media as MediaRow]);
      toast.success("Photo enregistrée");
      return;
    }
    toast.error(`${res.message} Vous pourrez réessayer avant de terminer le tour.`);
    const capture = prepareCapture(file);
    if (!capture) return;
    addFailedUpload({
      name: capture.name,
      retry: async () => {
        const again = await uploadCapture(capture.blob, folder, links);
        if (!again.ok) throw new Error(again.message);
        setItems((prev) => [...prev, again.media as MediaRow]);
      },
    });
  }

  async function remove(item: MediaRow) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await deleteMedia(item.id, item.storage_path);
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2.5 text-sm font-semibold"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          Prendre une photo
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2.5 text-sm font-semibold"
        >
          <Images className="h-4 w-4" />
          Galerie
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <div key={item.id} className="relative">
              <MediaThumb
                path={item.storage_path}
                onClick={() => lightbox.open(items.map((m) => ({ path: m.storage_path })), i)}
                className={compact ? "h-16 w-16 rounded-lg object-cover" : "h-20 w-20 rounded-lg object-cover"}
              />
              <button
                type="button"
                onClick={() => void remove(item)}
                aria-label="Supprimer la photo"
                className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-1 text-destructive-foreground"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {lightbox.node}
    </div>
  );
}