import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { ReportBody, Summary } from "@/routes/tour.$tourId.rapport";
import { fetchReport } from "@/lib/report";

export const Route = createFileRoute("/partage/$token")({
  head: () => ({
    meta: [
      { title: "Contrôle de votre véhicule — DDA Connect" },
      {
        name: "description",
        content: "Points à surveiller et défauts constatés lors du contrôle de votre véhicule.",
      },
      { property: "og:title", content: "Contrôle de votre véhicule — DDA Connect" },
      {
        property: "og:description",
        content: "Résultat du contrôle réalisé par Damien Digoin Automobile.",
      },
    ],
  }),
  component: SharePage,
});

function SharePage() {
  const { token } = Route.useParams();
  const report = useQuery({ queryKey: ["share", token], queryFn: () => fetchReport({ token }) });

  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <div className="h-10 w-1.5 rounded-full bg-brand" aria-hidden />
          <div>
            <h1 className="text-lg font-extrabold uppercase tracking-tight">DDA Connect</h1>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Contrôle de votre véhicule
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {report.isLoading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : report.data ? (
          <>
            <Summary d={report.data} />
            <ReportBody d={report.data} detailed={false} clientView />
            <p className="pt-4 text-center text-xs text-muted-foreground">
              Document d'information établi lors du contrôle atelier. Pour toute question, contactez
              votre conseiller.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Ce lien n'est plus disponible.</p>
        )}
      </main>
    </div>
  );
}