import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, FileText, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { DOC_ACCEPT, isImage } from "@/lib/documents";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { ocrSupplierInvoice } from "@/lib/ocr.functions";
import {
  DOC_STATUSES,
  fetchSupplierDocs,
  findOrderCandidates,
  linkSupplierDocToOrder,
  statusLabel,
  supplierDocUrl,
  updateSupplierDoc,
  uploadSupplierDoc,
  type DocStatus,
  type InvoiceExtract,
  type SupplierDoc,
} from "@/lib/supplier-docs";

export const Route = createFileRoute("/factures-fournisseur/")({
  head: () => ({
    meta: [
      { title: "BL et factures fournisseur — DDA Connect" },
      {
        name: "description",
        content:
          "Dépôt photo, image ou PDF des bons de livraison et factures fournisseur, lecture assistée, validation manuelle et suivi des états.",
      },
      { property: "og:title", content: "BL et factures fournisseur — DDA Connect" },
      { property: "og:description", content: "Scan tolérant, validation manuelle et rattachement à un OR." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplierInvoices,
});

function num(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

function SupplierInvoices() {
  const { user, displayName } = useAuth();
  const { active, isGroup } = useSite();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const docs = useQuery({
    queryKey: ["supplier-docs", active],
    queryFn: () => fetchSupplierDocs(isGroup ? null : active),
  });

  function choose(camera: boolean) {
    const el = inputRef.current;
    if (!el) return;
    if (camera) el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.accept = camera ? "image/*" : DOC_ACCEPT;
    el.click();
  }

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const compressed = isImage(file) ? await compressImage(file) : null;
      const usable = compressed
        ? new File([compressed], file.name, { type: compressed.type || file.type })
        : file;
      let extracted: InvoiceExtract = {};
      try {
        const dataUrl = await blobToDataUrl(usable);
        const res = await ocrSupplierInvoice({ data: { dataUrl, filename: usable.name } });
        if (res.ok) extracted = JSON.parse(res.json) as InvoiceExtract;
        else toast.warning(`${res.error} Le document est enregistré : complétez à la main.`);
      } catch {
        toast.warning("Lecture automatique indisponible : complétez les informations à la main.");
      }
      const created = await uploadSupplierDoc({
        file: usable,
        extracted,
        siteId: isGroup ? null : active,
        userId: user?.id ?? null,
        userName: displayName ?? null,
      });
      await qc.invalidateQueries({ queryKey: ["supplier-docs"] });
      setOpenId(created.id);
      toast.success("Document enregistré : vérifiez et validez les informations.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="BL / Factures fournisseur" subtitle="Réception et contrôle" back={{ to: "/magasin" }}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => choose(true)}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />} Photographier
          </button>
          <button
            onClick={() => choose(false)}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-border px-4 py-4 text-sm font-extrabold uppercase disabled:opacity-60"
          >
            <Paperclip className="h-5 w-5" /> Importer PDF / image
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.currentTarget.value = "";
            if (f) void handleFile(f);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Lecture assistée tolérante aux photos imparfaites et aux annotations manuscrites. Rien n'est créé
          automatiquement : chaque document passe par une validation manuelle.
        </p>

        {docs.data?.length ? (
          <ul className="space-y-2">
            {docs.data.map((d) => (
              <li key={d.id}>
                <DocCard doc={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Aucun BL ni facture fournisseur enregistré pour ce périmètre.
          </p>
        )}
      </div>
    </AppShell>
  );
}

function DocCard({ doc, open, onToggle }: { doc: SupplierDoc; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<InvoiceExtract>(doc.extracted);
  const [note, setNote] = useState(doc.note ?? "");
  const [orTerm, setOrTerm] = useState(doc.extracted.order_reference ?? "");
  const [candidates, setCandidates] = useState<{ id: string; or_number: string | null }[]>([]);
  const [saving, setSaving] = useState(false);

  async function save(status?: DocStatus) {
    setSaving(true);
    try {
      await updateSupplierDoc(doc.id, { extracted: form, note: note || null, plate: form.plate ?? null, status });
      await qc.invalidateQueries({ queryKey: ["supplier-docs"] });
      toast.success(status ? `État : ${statusLabel(status)}` : "Modifications enregistrées");
    } catch {
      toast.error("Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-surface p-3">
      <button onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <FileText className="h-5 w-5 shrink-0 text-brand" />
        <span className="flex-1">
          <span className="block text-sm font-extrabold uppercase">
            {doc.extracted.supplier ?? "Fournisseur inconnu"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {doc.extracted.invoice_number ?? doc.file_name} ·{" "}
            {doc.extracted.invoice_date ?? new Date(doc.created_at).toISOString().slice(0, 10)}
            {doc.extracted.total_ttc != null ? ` · ${doc.extracted.total_ttc} € TTC` : ""}
          </span>
        </span>
        <span className="rounded-lg border border-border px-2 py-1 text-[10px] font-bold uppercase">
          {statusLabel(doc.status)}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fournisseur" value={form.supplier ?? ""} onChange={(v) => setForm({ ...form, supplier: v || null })} />
            <Field label="N° facture" value={form.invoice_number ?? ""} onChange={(v) => setForm({ ...form, invoice_number: v || null })} />
            <Field label="N° BL" value={form.delivery_note_number ?? ""} onChange={(v) => setForm({ ...form, delivery_note_number: v || null })} />
            <Field label="Date" type="date" value={form.invoice_date ?? ""} onChange={(v) => setForm({ ...form, invoice_date: v || null })} />
            <Field label="Site / client" value={form.customer_or_site ?? ""} onChange={(v) => setForm({ ...form, customer_or_site: v || null })} />
            <Field label="Immatriculation" value={form.plate ?? ""} onChange={(v) => setForm({ ...form, plate: v || null })} />
            <Field label="Total HT" value={form.total_ht?.toString() ?? ""} onChange={(v) => setForm({ ...form, total_ht: num(v) })} />
            <Field label="TVA" value={form.vat_amount?.toString() ?? ""} onChange={(v) => setForm({ ...form, vat_amount: num(v) })} />
            <Field label="Total TTC" value={form.total_ttc?.toString() ?? ""} onChange={(v) => setForm({ ...form, total_ttc: num(v) })} />
          </div>

          {form.lines?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1">Référence</th>
                    <th className="py-1">Libellé</th>
                    <th className="py-1 text-right">Qté</th>
                    <th className="py-1 text-right">PU</th>
                    <th className="py-1 text-right">Rem.</th>
                    <th className="py-1 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1">{l.reference ?? "—"}</td>
                      <td className="py-1">{l.label ?? "—"}</td>
                      <td className="py-1 text-right">{l.quantity ?? "—"}</td>
                      <td className="py-1 text-right">{l.unit_price ?? "—"}</td>
                      <td className="py-1 text-right">{l.discount_pct != null ? `${l.discount_pct} %` : "—"}</td>
                      <td className="py-1 text-right">{l.amount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Aucune ligne lue : contrôlez le document d'origine.</p>
          )}

          <label className="block text-xs font-bold uppercase text-muted-foreground">
            Note libre / mentions manuscrites
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border-2 border-border bg-background p-2 text-sm font-normal normal-case"
              placeholder="Ex : Pas BL retour / Frs à rembourser"
            />
          </label>

          <div className="space-y-1">
            <label className="block text-xs font-bold uppercase text-muted-foreground">Rattacher à un OR</label>
            <div className="flex gap-2">
              <input
                value={orTerm}
                onChange={(e) => setOrTerm(e.target.value)}
                className="flex-1 rounded-lg border-2 border-border bg-background p-2 text-sm"
                placeholder="N° OR"
              />
              <button
                onClick={async () => setCandidates(await findOrderCandidates(orTerm))}
                className="rounded-lg border-2 border-border px-3 text-xs font-extrabold uppercase"
              >
                Chercher
              </button>
            </div>
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  await linkSupplierDocToOrder(doc.id, c.id);
                  await qc.invalidateQueries({ queryKey: ["supplier-docs"] });
                  toast.success("Document lié à l'OR");
                }}
                className="block w-full rounded-lg border border-border px-2 py-1 text-left text-xs"
              >
                Lier à l'OR {c.or_number ?? c.id.slice(0, 8)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase disabled:opacity-60"
            >
              Enregistrer
            </button>
            {DOC_STATUSES.filter((s) => s.key !== doc.status && s.key !== "lie_or").map((s) => (
              <button
                key={s.key}
                onClick={() => void save(s.key)}
                disabled={saving}
                className="rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase disabled:opacity-60"
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={async () => {
                const url = await supplierDocUrl(doc.storage_path);
                if (url) window.open(url, "_blank", "noopener");
              }}
              className="rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase"
            >
              Voir le document
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs font-bold uppercase text-muted-foreground">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border-2 border-border bg-background p-2 text-sm font-normal normal-case text-foreground"
      />
    </label>
  );
}
