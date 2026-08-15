import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ExpertiseReport } from "@/components/ExpertiseReportView";
import { fetchExpertise } from "@/lib/expertise";

export const Route = createFileRoute("/expertise-partage/$token")({
  head: () => ({
    meta: [
      { title: "Votre rapport d'expertise — Damien Digoin Automobile" },
      {
        name: "description",
        content:
          "Consultez le rapport d'expertise de votre véhicule : photos, dommages constatés et estimation des remises en état.",
      },
      { property: "og:title", content: "Votre rapport d'expertise véhicule" },
      {
        property: "og:description",
        content: "Photos, dommages constatés et estimation des remises en état.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SharedExpertise,
});

function SharedExpertise() {
  const { token } = Route.useParams();
  const q = useQuery({
    queryKey: ["expertise-share", token],
    queryFn: () => fetchExpertise({ token }),
  });

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <div className="h-10 w-1.5 rounded-full bg-brand" aria-hidden />
          <div>
            <h1 className="text-lg font-extrabold uppercase tracking-tight">
              Damien Digoin Automobile
            </h1>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Rapport d'expertise véhicule
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-5">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : q.data ? (
          <ExpertiseReport d={q.data} />
        ) : (
          <p className="text-sm text-muted-foreground">Ce rapport n'est plus disponible.</p>
        )}
      </main>
    </div>
  );
}