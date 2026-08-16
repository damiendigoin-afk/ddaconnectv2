import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge, Section, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { analyzeCreditNoteFn } from "@/lib/bodyshop-ai.functions";
import { blobToDataUrl, BUCKET, compressImage } from "@/lib/photo";
import { listSuppliers } from "@/lib/referentials";
import { listReturns, refreshReturnCredit, type CreditNote } from "@/lib/returns";

export const Route = createFileRoute("/magasin/avoirs")({
  head: () => ({
    meta: [
      { title: "Avoirs fournisseurs — DDA Connect" },
      { name: "description", content: "Importer un avoir fournisseur, le rapprocher automatiquement des retours et solder les écarts." },
      { property: "og:title", content: "Avoirs fournisseurs — DDA Connect" },
      { property: "og:description", content: "Rapprochement automatique des avoirs et des retours de pièces." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreditNotes,
});

function CreditNotes() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const returns = useQuery({ queryKey: ["returns"], queryFn: listReturns });
  const notes = useQuery({
    queryKey: ["credit-notes"],
    queryFn: async () => {
      const { data } = await supabase.from("credit_notes").select("*").order("created_at", { ascending: false }).limit(100);
      return (data ?? []) as CreditNote[];
    },
  });

  async function upload(file: File) {
    if (!supplierId) {
      setMsg("Choisis d'abord le fournisseur.");
      return;
    }
    setBusy(true);
    setMsg("Analyse de l'avoir…");
    try {
      const isImage = file.type.startsWith("image/");
      const blob = isImage ? await compressImage(file, 2000, 0.85) : file;
      const path = `magasin/avoirs/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      await supabase.storage.from(BUCKET).upload(path, blob, { contentType: file.type || "application/octet-stream" });
      const res = await analyzeCreditNoteFn({ data: { dataUrl: await blobToDataUrl(blob), filename: file.name } });
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      const a = JSON.parse(res.json) as Record<string, unknown>;
      const { data: note } = await supabase
        .from("credit_notes")
        .insert({
          supplier_id: supplierId,
          number: a["number"] ? String(a["number"]) : null,
          credit_date: a["date"] ? String(a["date"]) : null,
          total_amount: a["total_amount"] ? Number(a["total_amount"]) : null,
          storage_path: path,
          analysis: a as never,
          status: "importe",
        })
        .select()
        .single();

      const lines = (a["lines"] as Record<string, unknown>[] | undefined) ?? [];
      const openLines = (returns.data ?? [])
        .filter((r) => r.supplier_id === supplierId)
        .flatMap((r) => r.lines.map((l) => ({ ...l, returnId: r.id })));

      let matched = 0;
      for (const l of lines) {
        const ref = l["reference"] ? String(l["reference"]).toUpperCase().replace(/\s/g, "") : "";
        const target = openLines.find((o) => (o.reference ?? "").toUpperCase().replace(/\s/g, "") === ref && ref);
        await supabase.from("credit_note_lines").insert({
          credit_note_id: (note as CreditNote).id,
          return_line_id: target?.id ?? null,
          reference: l["reference"] ? String(l["reference"]) : null,
          label: l["label"] ? String(l["label"]) : null,
          quantity: l["quantity"] ? Number(l["quantity"]) : null,
          amount: l["amount"] ? Number(l["amount"]) : null,
          matched: Boolean(target),
        });
        if (target) {
          matched += 1;
          await supabase
            .from("part_return_lines")
            .update({
              credited_quantity: Number(l["quantity"] ?? target.quantity ?? 0),
              credited_amount: Number(l["amount"] ?? 0),
              status: "avoire",
            })
            .eq("id", target.id);
          await refreshReturnCredit(target.returnId);
        }
      }
      setMsg(`Avoir importé : ${matched}/${lines.length} ligne(s) rapprochée(s).`);
      void qc.invalidateQueries({ queryKey: ["credit-notes"] });
      void qc.invalidateQueries({ queryKey: ["returns"] });
    } catch {
      setMsg("Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Avoirs fournisseurs" subtitle="Import et rapprochement" back={{ to: "/magasin" }}>
      <div className="space-y-3">
        <Select label="Fournisseur" value={supplierId} onChange={setSupplierId} options={(suppliers.data ?? []).map((s) => ({ key: s.id, label: s.name }))} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-4 text-brand-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
          <span className="text-base font-extrabold uppercase tracking-wide">Importer un avoir (PDF ou photo)</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}
      </div>

      <Section title="Avoirs importés">
        <ul className="space-y-2">
          {(notes.data ?? []).map((n) => (
            <li key={n.id} className="card-surface p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-bold">{n.number ?? "Avoir sans numéro"}</span>
                <span>{n.total_amount ? `${Number(n.total_amount).toFixed(2)} €` : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{suppliers.data?.find((s) => s.id === n.supplier_id)?.name ?? "—"}</span>
                <Badge>{n.status}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </AppShell>
  );
}
