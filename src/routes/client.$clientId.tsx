import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Car, ChevronDown, Mail, MapPin, Phone } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { customerName, fetchCustomer, vehicleLabel } from "@/lib/refbase";

export const Route = createFileRoute("/client/$clientId")({
  head: () => ({
    meta: [
      { title: "Fiche client — DDA Connect" },
      { name: "description", content: "Identité, coordonnées, adresse et véhicules d'un client du référentiel DDA Connect." },
      { property: "og:title", content: "Fiche client — DDA Connect" },
      { property: "og:description", content: "Coordonnées et véhicules du client." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientPage,
});

const CONTACT_LABELS: Record<string, string> = {
  EMAIL: "Email",
  MOBILE: "Mobile",
  PHONE: "Téléphone",
  WORK_PHONE: "Téléphone pro",
  OTHER: "Autre",
};

function ClientPage() {
  const { clientId } = Route.useParams();
  const { isManager } = useAuth();
  const [full, setFull] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["customer", clientId], queryFn: () => fetchCustomer(clientId) });

  const c = data?.customer;
  const addr = data?.addresses?.[0];

  return (
    <AppShell title={c ? customerName(c) : "Fiche client"} subtitle={c?.source_customer_id ? `Client n° ${c.source_customer_id}` : undefined} back={{ to: "/base" }}>
      <div className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {!isLoading && !c ? <p className="card-surface p-5 text-sm">Client introuvable.</p> : null}

        {c ? (
          <>
            <section className="card-surface space-y-1 p-4">
              <h2 className="text-xs font-bold uppercase text-muted-foreground">Identité</h2>
              <p className="text-lg font-extrabold">{customerName(c)}</p>
              {c.company_name && (c.last_name || c.first_name) ? (
                <p className="text-sm text-muted-foreground">{[c.first_name, c.last_name].filter(Boolean).join(" ")}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {c.customer_type === "company" ? "Entreprise" : "Particulier"}
                {c.source_customer_id ? ` · n° ${c.source_customer_id}` : ""}
              </p>
            </section>

            <section className="card-surface p-4">
              <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Contact</h2>
              {data?.contacts.length ? (
                <ul className="space-y-2">
                  {data.contacts.map((ct) => (
                    <li key={ct.id} className="flex items-center gap-2 text-sm">
                      {ct.type === "EMAIL" ? (
                        <Mail className="h-4 w-4 shrink-0 text-brand" />
                      ) : (
                        <Phone className="h-4 w-4 shrink-0 text-brand" />
                      )}
                      <a
                        href={ct.type === "EMAIL" ? `mailto:${ct.value}` : `tel:${ct.value}`}
                        className="font-semibold underline-offset-2 hover:underline"
                      >
                        {ct.value}
                      </a>
                      <span className="text-xs text-muted-foreground">{CONTACT_LABELS[ct.type] ?? ct.type}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Aucune coordonnée.</p>
              )}
            </section>

            {addr ? (
              <section className="card-surface p-4">
                <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Adresse</h2>
                <p className="flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <span>
                    {[addr.address_line_1, addr.address_line_2, addr.address_line_3].filter(Boolean).join(", ")}
                    <br />
                    {[addr.postal_code, addr.city].filter(Boolean).join(" ")}
                    {addr.country ? ` — ${addr.country}` : ""}
                  </span>
                </p>
              </section>
            ) : null}

            <section className="space-y-2">
              <h2 className="px-1 text-xs font-bold uppercase text-muted-foreground">
                Véhicules ({data?.vehicles.length ?? 0})
              </h2>
              {(data?.vehicles ?? []).map((v) => (
                <Link
                  key={v.id}
                  to="/vehicule/$vehId"
                  params={{ vehId: v.id }}
                  className="flex items-center gap-3 rounded-xl border-2 border-border bg-card px-3 py-3"
                >
                  <Car className="h-5 w-5 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold">{v.registration_display ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">{vehicleLabel(v)}</div>
                  </div>
                </Link>
              ))}
              {!data?.vehicles.length ? (
                <p className="card-surface p-4 text-sm text-muted-foreground">Aucun véhicule rattaché.</p>
              ) : null}
            </section>

            {isManager ? (
              <section className="card-surface p-4">
                <button
                  onClick={() => setFull((f) => !f)}
                  className="flex w-full items-center justify-between text-xs font-bold uppercase text-muted-foreground"
                >
                  Informations complètes
                  <ChevronDown className={`h-4 w-4 transition-transform ${full ? "rotate-180" : ""}`} />
                </button>
                {full ? (
                  <dl className="mt-3 space-y-1 text-sm">
                    {Object.entries(c as Record<string, unknown>)
                      .filter(([, v]) => v !== null && v !== "" && v !== undefined)
                      .map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="truncate font-medium">{String(v)}</dd>
                        </div>
                      ))}
                  </dl>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
