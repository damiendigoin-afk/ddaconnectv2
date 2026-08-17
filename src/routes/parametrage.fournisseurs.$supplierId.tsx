import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Field, Section, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  CONTACT_SERVICES,
  SUPPLIER_CATEGORIES,
  contactName,
  getSupplier,
  listContacts,
  serviceLabel,
} from "@/lib/suppliers";

export const Route = createFileRoute("/parametrage/fournisseurs/$supplierId")({
  head: () => ({
    meta: [
      { title: "Fiche fournisseur — DDA Connect" },
      { name: "description", content: "Coordonnées, conditions de retour et contacts par service d'un fournisseur du référentiel global." },
      { property: "og:title", content: "Fiche fournisseur — DDA Connect" },
      { property: "og:description", content: "Coordonnées, conditions de retour et contacts par service." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplierDetail,
});

function SupplierDetail() {
  const { supplierId } = Route.useParams();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const supplier = useQuery({ queryKey: ["supplier", supplierId], queryFn: () => getSupplier(supplierId) });
  const contacts = useQuery({ queryKey: ["supplier-contacts", supplierId], queryFn: () => listContacts(supplierId) });

  const [f, setF] = useState<Record<string, string>>({});
  const [active, setActive] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const s = supplier.data;
    if (!s) return;
    setF({
      name: s.name ?? "",
      trade_name: s.trade_name ?? "",
      group_name: s.group_name ?? "",
      category: s.category ?? "pieces",
      brands: s.brands ?? "",
      address: s.address ?? "",
      postal_code: s.postal_code ?? "",
      city: s.city ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      website: s.website ?? "",
      returns_email: s.returns_email ?? "",
      max_return_days: s.max_return_days ? String(s.max_return_days) : "",
      avg_credit_days: s.avg_credit_days ? String(s.avg_credit_days) : "",
      notes: s.notes ?? "",
    });
    setActive(s.active);
  }, [supplier.data]);

  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  if (!isManager) {
    return (
      <AppShell title="Fournisseur" back={{ to: "/parametrage/fournisseurs" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      </AppShell>
    );
  }

  async function save() {
    await supabase
      .from("suppliers")
      .update({
        name: (f["name"] ?? "").trim() || "Fournisseur",
        trade_name: f["trade_name"] || null,
        group_name: f["group_name"] || null,
        category: f["category"] || null,
        brands: f["brands"] || null,
        address: f["address"] || null,
        postal_code: f["postal_code"] || null,
        city: f["city"] || null,
        phone: f["phone"] || null,
        email: f["email"] || null,
        website: f["website"] || null,
        returns_email: f["returns_email"] || null,
        max_return_days: f["max_return_days"] ? Number(f["max_return_days"]) : null,
        avg_credit_days: f["avg_credit_days"] ? Number(f["avg_credit_days"]) : null,
        notes: f["notes"] || null,
        active,
      })
      .eq("id", supplierId);
    setMsg("Fiche enregistrée.");
    void qc.invalidateQueries({ queryKey: ["suppliers"] });
    void qc.invalidateQueries({ queryKey: ["supplier", supplierId] });
  }

  return (
    <AppShell title={supplier.data?.trade_name || supplier.data?.name || "Fournisseur"} subtitle="Fiche et contacts" back={{ to: "/parametrage/fournisseurs" }}>
      <Section title="Identité">
        <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
          <Field label="Raison sociale" value={f["name"] ?? ""} onChange={set("name")} />
          <Field label="Enseigne" value={f["trade_name"] ?? ""} onChange={set("trade_name")} />
          <Field label="Groupe" value={f["group_name"] ?? ""} onChange={set("group_name")} />
          <Select label="Catégorie" value={f["category"] ?? ""} onChange={set("category")} options={SUPPLIER_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} allowEmpty={false} />
          <Field label="Marques distribuées" value={f["brands"] ?? ""} onChange={set("brands")} placeholder="Renault, Dacia…" />
          <button
            onClick={() => setActive((a) => !a)}
            className={`w-full rounded-lg border-2 py-2 text-sm font-bold uppercase ${active ? "border-border" : "border-amber-500 bg-amber-100 text-amber-950"}`}
          >
            {active ? "Fournisseur actif" : "Fournisseur inactif"}
          </button>
        </div>
      </Section>

      <Section title="Coordonnées">
        <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
          <Field label="Adresse" value={f["address"] ?? ""} onChange={set("address")} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Code postal" value={f["postal_code"] ?? ""} onChange={set("postal_code")} />
            <Field label="Ville" value={f["city"] ?? ""} onChange={set("city")} />
          </div>
          <Field label="Téléphone" value={f["phone"] ?? ""} onChange={set("phone")} />
          <Field label="E-mail général" value={f["email"] ?? ""} onChange={set("email")} type="email" />
          <Field label="Site web" value={f["website"] ?? ""} onChange={set("website")} />
        </div>
      </Section>

      <Section title="Conditions pièces & retours">
        <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
          <Field label="E-mail retours (secours)" value={f["returns_email"] ?? ""} onChange={set("returns_email")} type="email" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Délai max retour (j)" value={f["max_return_days"] ?? ""} onChange={set("max_return_days")} />
            <Field label="Délai moyen avoir (j)" value={f["avg_credit_days"] ?? ""} onChange={set("avg_credit_days")} />
          </div>
          <p className="text-xs text-muted-foreground">
            Les e-mails de retour et de relance d'avoir partent en priorité au contact « Retour PR », puis « Magasin PR », puis à cette adresse.
          </p>
        </div>
      </Section>

      <Section title="Observations">
        <div className="rounded-xl border-2 border-border bg-card p-3">
          <Area label="Notes internes" value={f["notes"] ?? ""} onChange={set("notes")} />
        </div>
      </Section>

      <button onClick={() => void save()} className="mt-3 w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground">
        Enregistrer la fiche
      </button>
      {msg ? <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}

      <Contacts supplierId={supplierId} contacts={contacts.data ?? []} />
    </AppShell>
  );
}

function Contacts({ supplierId, contacts }: { supplierId: string; contacts: Awaited<ReturnType<typeof listContacts>> }) {
  const qc = useQueryClient();
  const reload = () => void qc.invalidateQueries({ queryKey: ["supplier-contacts", supplierId] });
  const [open, setOpen] = useState(false);
  const [service, setService] = useState("magasin_pr");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");

  return (
    <Section
      title="Contacts par service"
      right={
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-bold uppercase text-brand">
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      }
    >
      {open ? (
        <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
          <Select label="Service" value={service} onChange={setService} options={CONTACT_SERVICES.map((s) => ({ key: s.key, label: s.label }))} allowEmpty={false} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Prénom" value={first} onChange={setFirst} />
            <Field label="Nom" value={last} onChange={setLast} />
          </div>
          <Field label="Téléphone" value={phone} onChange={setPhone} />
          <Field label="Portable" value={mobile} onChange={setMobile} />
          <Field label="E-mail" value={email} onChange={setEmail} type="email" />
          <button
            onClick={async () => {
              if (!last.trim() && !email.trim()) return;
              await supabase.from("supplier_contacts").insert({
                supplier_id: supplierId,
                service,
                first_name: first || null,
                last_name: last || null,
                phone: phone || null,
                mobile: mobile || null,
                email: email || null,
              });
              setFirst(""); setLast(""); setPhone(""); setMobile(""); setEmail("");
              setOpen(false);
              reload();
            }}
            className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
          >
            Ajouter le contact
          </button>
        </div>
      ) : null}

      <ul className="space-y-2">
        {contacts.map((c) => (
          <li key={c.id} className="card-surface p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{contactName(c)}</span>
              <Badge>{serviceLabel(c.service)}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {[c.mobile, c.phone, c.email].filter(Boolean).join(" · ") || "—"}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={async () => {
                  await supabase.from("supplier_contacts").update({ is_primary: false }).eq("supplier_id", supplierId).eq("service", c.service);
                  await supabase.from("supplier_contacts").update({ is_primary: true }).eq("id", c.id);
                  reload();
                }}
                className={`flex items-center gap-1 rounded-lg border-2 px-2 py-1 text-xs font-bold ${c.is_primary ? "border-brand bg-brand/10" : "border-border"}`}
              >
                <Star className="h-3.5 w-3.5" /> {c.is_primary ? "Principal" : "Définir principal"}
              </button>
              <button
                onClick={async () => {
                  await supabase.from("supplier_contacts").delete().eq("id", c.id);
                  reload();
                }}
                className="flex items-center gap-1 rounded-lg border-2 border-border px-2 py-1 text-xs font-bold text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </button>
            </div>
          </li>
        ))}
        {contacts.length === 0 ? <li className="px-1 text-sm text-muted-foreground">Aucun contact enregistré.</li> : null}
      </ul>
    </Section>
  );
}
