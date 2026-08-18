import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ClipboardList, ListChecks, Loader2, Pencil, Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { MileageCard } from "@/components/MileageCard";
import { InfoEditForm } from "@/components/InfoEditForm";
import { useAuth } from "@/lib/auth";
import { fetchInspections, fetchOrder } from "@/lib/queries";
import { formatPlate } from "@/lib/plate";
import { createInspection } from "@/lib/tour";
import { GUIDED_ZONES } from "@/lib/zones";

export const Route = createFileRoute("/or/$orId")({
  head: () => ({
    meta: [
      { title: "Fiche OR — DDA Connect" },
      {
        name: "description",
        content: "Détail de l'ordre de réparation, historique des tours véhicule et rapports.",
      },
      { property: "og:title", content: "Fiche OR — DDA Connect" },
      { property: "og:description", content: "Ordre de réparation et tours véhicule associés." },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const { orId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [details, setDetails] = useState(false);
  const [starting, setStarting] = useState(false);
  const [editMileage, setEditMileage] = useState(false);
  const [editing, setEditing] = useState(false);
  const { user, displayName, profile } = useAuth();

  const order = useQuery({ queryKey: ["order", orId], queryFn: () => fetchOrder(orId) });
  const tours = useQuery({ queryKey: ["inspections", orId], queryFn: () => fetchInspections(orId) });

  const v = order.data?.vehicle as {
    id?: string;
    plate?: string;
    brand?: string;
    model?: string;
    vin?: string;
    last_mileage?: number | null;
    first_registration?: string | null;
  } | null;
  const c = order.data?.client as Record<string, string | null> | null;

  async function start(type: "libre" | "guide") {
    if (!order.data || !v?.id) return;
    setStarting(true);
    try {
      const insp = await createInspection(orId, v.id, type, {
        userId: user?.id ?? null,
        userName: displayName || null,
        siteId: (profile?.site_id as string | null) ?? null,
      });
      await qc.invalidateQueries({ queryKey: ["inspections", orId] });
      navigate({ to: "/tour/$tourId", params: { tourId: insp.id } });
    } catch (e) {
      console.error(e);
      toast.error("Impossible de démarrer le tour");
    } finally {
      setStarting(false);
    }
  }

  return (
    <AppShell title={formatPlate(v?.plate ?? "")} subtitle={`OR ${order.data?.or_number ?? "—"}`} back={{ to: "/tour-vehicule" }}>
      {order.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : editing && order.data ? (
        <InfoEditForm
          order={order.data as unknown as Record<string, unknown>}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            void qc.invalidateQueries({ queryKey: ["order", orId] });
            void qc.invalidateQueries({ queryKey: ["recent-orders"] });
          }}
        />
      ) : (
        <div className="space-y-4">
          <section className="card-surface p-4">
            <div className="plate-badge text-3xl">{formatPlate(v?.plate ?? "")}</div>
            <div className="text-base font-semibold">
              {[v?.brand, v?.model].filter(Boolean).join(" ") || "Véhicule"}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <Info label="Kilométrage connu" value={v?.last_mileage ? `${v.last_mileage.toLocaleString("fr-FR")} km` : "—"} />
              <Info label="Date OR" value={order.data?.or_date ? new Date(order.data.or_date).toLocaleDateString("fr-FR") : "—"} />
              <Info label="N° OR" value={order.data?.or_number ?? "—"} />
              <Info label="Client" value={[c?.["first_name"], c?.["last_name"]].filter(Boolean).join(" ") || "—"} />
            </div>
            <button
              onClick={() => setDetails((d) => !d)}
              className="mt-3 flex w-full items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm font-semibold"
            >
              Informations détaillées
              <ChevronDown className={`h-4 w-4 transition-transform ${details ? "rotate-180" : ""}`} />
            </button>
            {details ? (
              <div className="mt-3 space-y-1 text-sm">
                <Info label="VIN" value={v?.vin ?? "—"} />
                <Info label="1re mise en circulation" value={v?.first_registration ?? "—"} />
                <Info label="Compte client" value={c?.["account_number"] ?? "—"} />
                <Info label="Adresse" value={[c?.["address"], c?.["address_extra"], c?.["postal_code"], c?.["city"]].filter(Boolean).join(" ") || "—"} />
                <Info label="Téléphone" value={c?.["phone"] ?? "—"} />
                <Info label="Mobile" value={c?.["mobile"] ?? "—"} />
                <Info label="Email" value={c?.["email"] ?? "—"} />
                <Info label="Entrée" value={order.data?.entry_at ? new Date(order.data.entry_at).toLocaleString("fr-FR") : "—"} />
                <Info label="Restitution" value={order.data?.delivery_at ? new Date(order.data.delivery_at).toLocaleString("fr-FR") : "—"} />
              </div>
            ) : null}
          </section>

          <button
            onClick={() => setEditing(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-bold uppercase tracking-wide"
          >
            <Pencil className="h-4 w-4" /> Modifier les informations
          </button>

          {order.data?.requested_work || order.data?.client_remarks ? (
            <section className="card-surface space-y-3 p-4">
              {order.data?.requested_work ? (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Travaux prévus
                  </h2>
                  <p className="whitespace-pre-wrap text-sm">{order.data.requested_work}</p>
                </div>
              ) : null}
              {order.data?.client_remarks ? (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Remarques client
                  </h2>
                  <p className="whitespace-pre-wrap text-sm">{order.data.client_remarks}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Kilométrage
            </h2>
            {editMileage && v?.id ? (
              <MileageCard
                title="Mettre à jour le kilométrage"
                vehicleId={v.id}
                previous={v.last_mileage ?? null}
                current={v.last_mileage ?? null}
                onSaved={() => {
                  setEditMileage(false);
                  void qc.invalidateQueries({ queryKey: ["order", orId] });
                  toast.success("Kilométrage véhicule mis à jour");
                }}
              />
            ) : (
              <button
                onClick={() => setEditMileage(true)}
                className="flex w-full items-center justify-between rounded-xl border-2 border-border bg-card px-4 py-4 text-left"
              >
                <span>
                  <span className="block text-xs uppercase tracking-widest text-muted-foreground">
                    Kilométrage connu
                  </span>
                  <span className="block text-lg font-extrabold">
                    {v?.last_mileage ? `${v.last_mileage.toLocaleString("fr-FR")} km` : "—"}
                  </span>
                </span>
                <span className="rounded-lg bg-secondary px-3 py-2 text-xs font-bold uppercase">
                  Mettre à jour
                </span>
              </button>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Démarrer un tour véhicule
            </h2>
            <button
              onClick={() => void start("libre")}
              disabled={starting}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-primary bg-card px-4 py-4 text-left"
            >
              <ListChecks className="h-6 w-6" />
              <span>
                <span className="block font-extrabold uppercase">Tour libre</span>
                <span className="block text-xs text-muted-foreground">
                  Signaler uniquement les défauts constatés
                </span>
              </span>
            </button>
            <button
              onClick={() => void start("guide")}
              disabled={starting}
              className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-4 text-left text-brand-foreground"
            >
              {starting ? <Loader2 className="h-6 w-6 animate-spin" /> : <RouteIcon className="h-6 w-6" />}
              <span>
                <span className="block font-extrabold uppercase">Tour guidé</span>
                <span className="block text-xs opacity-80">Effectuer le contrôle étape par étape</span>
              </span>
            </button>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Tours véhicule ({tours.data?.length ?? 0})
            </h2>
            {(tours.data ?? []).map((t) => {
              const d = new Date(t.completed_at ?? t.started_at ?? Date.now());
              return (
                <Link
                  key={t.id}
                  to={t.status === "completed" ? "/tour/$tourId/rapport" : "/tour/$tourId"}
                  params={{ tourId: t.id }}
                  className="card-surface flex items-start gap-3 p-4"
                >
                  <ClipboardList className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">
                      {d.toLocaleDateString("fr-FR")} — {d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="text-sm font-semibold uppercase">
                      {t.inspection_type === "guide" ? "Tour guidé" : "Tour libre"}
                      {t.status === "draft" ? (
                        <span className="ml-2 rounded bg-status-watch-soft px-1.5 py-0.5 text-xs font-bold text-status-watch">
                          Brouillon
                        </span>
                      ) : (
                        <span className="ml-2 rounded bg-status-ok-soft px-1.5 py-0.5 text-xs font-bold text-status-ok">
                          Terminé
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {t.inspection_type === "guide" ? (
                        <span>
                          {t.status === "draft"
                            ? `Zone ${t.current_zone_index}/${GUIDED_ZONES.length}`
                            : `${t.points} points contrôlés`}
                        </span>
                      ) : (
                        <span>{t.observations} défaut(s) signalé(s)</span>
                      )}
                      <span>{t.photos} photo(s)</span>
                      {t.mileage ? <span>{t.mileage.toLocaleString("fr-FR")} km</span> : null}
                      {t.inspection_type === "guide" ? <span>{t.anomalies} anomalie(s)</span> : null}
                    </div>
                  </div>
                </Link>
              );
            })}
            {tours.data?.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Aucun tour véhicule pour cet OR.
              </p>
            ) : null}
          </section>
        </div>
      )}
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}