import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Field, Select } from "@/components/bits";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { listAgreements, listExperts, listFirms, listInsurers } from "@/lib/referentials";

export const Route = createFileRoute("/carrosserie/referentiels")({
  head: () => ({
    meta: [
      { title: "Référentiels carrosserie — DDA Connect" },
      { name: "description", content: "Assurances, cabinets d'expertise, experts, agréments et fournisseurs du garage." },
      { property: "og:title", content: "Référentiels carrosserie — DDA Connect" },
      { property: "og:description", content: "Gestion des assurances, experts, agréments et fournisseurs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Referentials,
});

const TABS = ["Assurances", "Cabinets", "Experts", "Agréments"] as const;

function Referentials() {
  const { isManager } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Assurances");

  if (!isManager) {
    return (
      <AppShell title="Référentiels" back={{ to: "/carrosserie" }}>
        <p className="rounded-lg bg-amber-100 px-3 py-3 text-sm text-amber-950">Accès réservé aux managers.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Référentiels" subtitle="Carrosserie & magasin" back={{ to: "/carrosserie" }}>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 rounded-lg border-2 px-3 py-2 text-sm font-bold ${tab === t ? "border-brand bg-brand/10" : "border-border"}`}>
            {t}
          </button>
        ))}
      </div>
      <Link to="/parametrage/fournisseurs" className="mb-1 block rounded-lg border-2 border-dashed border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Fournisseurs → paramétrage global
      </Link>
      {tab === "Assurances" ? <Insurers /> : null}
      {tab === "Cabinets" ? <Firms /> : null}
      {tab === "Experts" ? <Experts /> : null}
      {tab === "Agréments" ? <Agreements /> : null}
    </AppShell>
  );
}

function useReload(key: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: [key] });
}

function Insurers() {
  const q = useQuery({ queryKey: ["insurers"], queryFn: listInsurers });
  const reload = useReload("insurers");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
        <Field label="Nom" value={name} onChange={setName} />
        <Field label="E-mail" value={email} onChange={setEmail} type="email" />
        <Field label="Téléphone" value={phone} onChange={setPhone} />
        <button
          onClick={async () => {
            if (!name.trim()) return;
            await supabase.from("insurers").insert({ name: name.trim(), email: email || null, phone: phone || null });
            setName(""); setEmail(""); setPhone(""); reload();
          }}
          className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
        >
          Ajouter l'assurance
        </button>
      </div>
      <ul className="space-y-2">
        {(q.data ?? []).map((i) => (
          <li key={i.id} className="card-surface p-3 text-sm">
            <div className="font-bold">{i.name}</div>
            <div className="text-xs text-muted-foreground">{[i.email, i.phone].filter(Boolean).join(" · ") || "—"}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Firms() {
  const q = useQuery({ queryKey: ["firms"], queryFn: listFirms });
  const reload = useReload("firms");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ead, setEad] = useState("");

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
        <Field label="Cabinet" value={name} onChange={setName} />
        <Field label="E-mail général" value={email} onChange={setEmail} type="email" />
        <Field label="E-mail EAD" value={ead} onChange={setEad} type="email" />
        <button
          onClick={async () => {
            if (!name.trim()) return;
            await supabase.from("expert_firms").insert({ name: name.trim(), email: email || null, ead_email: ead || null });
            setName(""); setEmail(""); setEad(""); reload();
          }}
          className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
        >
          Ajouter le cabinet
        </button>
      </div>
      <ul className="space-y-2">
        {(q.data ?? []).map((f) => (
          <li key={f.id} className="card-surface p-3 text-sm">
            <div className="font-bold">{f.name}</div>
            <div className="text-xs text-muted-foreground">EAD : {f.ead_email ?? f.email ?? "—"}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Experts() {
  const q = useQuery({ queryKey: ["experts"], queryFn: listExperts });
  const firms = useQuery({ queryKey: ["firms"], queryFn: listFirms });
  const reload = useReload("experts");
  const [firmId, setFirmId] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [ead, setEad] = useState("");
  const [supp, setSupp] = useState("");
  const [mobile, setMobile] = useState("");

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
        <Select label="Cabinet" value={firmId} onChange={setFirmId} options={(firms.data ?? []).map((f) => ({ key: f.id, label: f.name }))} />
        <Field label="Prénom" value={first} onChange={setFirst} />
        <Field label="Nom" value={last} onChange={setLast} />
        <Field label="Mobile" value={mobile} onChange={setMobile} />
        <Field label="E-mail" value={email} onChange={setEmail} type="email" />
        <Field label="E-mail EAD" value={ead} onChange={setEad} type="email" />
        <Field label="E-mail compléments" value={supp} onChange={setSupp} type="email" />
        <button
          onClick={async () => {
            if (!last.trim()) return;
            await supabase.from("experts").insert({
              firm_id: firmId || null, first_name: first || null, last_name: last.trim(),
              mobile: mobile || null, email: email || null, ead_email: ead || null, supplement_email: supp || null,
            });
            setFirst(""); setLast(""); setEmail(""); setEad(""); setSupp(""); setMobile(""); reload();
          }}
          className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
        >
          Ajouter l'expert
        </button>
      </div>
      <ul className="space-y-2">
        {(q.data ?? []).map((e) => (
          <li key={e.id} className="card-surface p-3 text-sm">
            <div className="font-bold">{[e.first_name, e.last_name].filter(Boolean).join(" ")}</div>
            <div className="text-xs text-muted-foreground">
              {firms.data?.find((f) => f.id === e.firm_id)?.name ?? "—"} · {e.mobile ?? e.email ?? "—"}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Agreements() {
  const q = useQuery({ queryKey: ["agreements"], queryFn: listAgreements });
  const insurers = useQuery({ queryKey: ["insurers"], queryFn: listInsurers });
  const reload = useReload("agreements");
  const [name, setName] = useState("");
  const [insurerId, setInsurerId] = useState("");
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [t3, setT3] = useState("");
  const [paint, setPaint] = useState("");
  const [rules, setRules] = useState("");
  const n = (v: string) => (v ? Number(v.replace(",", ".")) : null);

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
        <Field label="Nom de l'agrément" value={name} onChange={setName} />
        <Select label="Assurance" value={insurerId} onChange={setInsurerId} options={(insurers.data ?? []).map((i) => ({ key: i.id, label: i.name }))} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="T1" value={t1} onChange={setT1} />
          <Field label="T2" value={t2} onChange={setT2} />
          <Field label="T3" value={t3} onChange={setT3} />
          <Field label="Taux peinture" value={paint} onChange={setPaint} />
        </div>
        <Field label="Règles particulières" value={rules} onChange={setRules} />
        <button
          onClick={async () => {
            if (!name.trim()) return;
            await supabase.from("agreements").insert({
              name: name.trim(), insurer_id: insurerId || null,
              t1: n(t1), t2: n(t2), t3: n(t3), paint_rate: n(paint), special_rules: rules || null,
            });
            setName(""); setT1(""); setT2(""); setT3(""); setPaint(""); setRules(""); reload();
          }}
          className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
        >
          Ajouter l'agrément
        </button>
      </div>
      <ul className="space-y-2">
        {(q.data ?? []).map((a) => (
          <li key={a.id} className="card-surface p-3 text-sm">
            <div className="font-bold">{a.name}</div>
            <div className="text-xs text-muted-foreground">
              T1 {a.t1 ?? "—"} · T2 {a.t2 ?? "—"} · T3 {a.t3 ?? "—"} · Peinture {a.paint_rate ?? "—"}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
