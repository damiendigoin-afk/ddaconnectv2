<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- V3 navigation: home = search + scan + Atelier / Pièces & achats / Notes de frais first; `/atelier` and `/pieces-achats` hubs; `/magasin` redirects. Why: OR-centric workshop flow.
- Rights = menu access only (module key grants all functions of that menu; legacy fine keys still honoured server-side). Why: V3 simplification.
- DDA never creates official OR numbers; a dossier without WinMotor OR is labelled "Dossier DDA — en attente OR WinMotor" and blocks time/parts/work-done actions. Why: WinMotor primacy.
- Measures: all measure display/save goes through src/lib/measure.ts (NaN/Infinity/empty/non-numeric => null). Why: "NaN mm" leaked into reports.
- tslib pinned to ^2 via package.json overrides. Why: pdf-lib with tslib 1.x crashed in the server bundle (__extends/__toESM).
- Never name app modules `*.client.ts` when a route/component imports them: TanStack import-protection denies them in the server build and silently blocks every publish. Use `*.browser.ts` + browser-only APIs inside functions.
- Recette IA (banc A/B) isolée dans src/lib/bench-*.ts + bench.server.ts : écrit seulement ai_bench_*, dda-media/benchmark/ et ai_usage_log (feature ai_document_benchmark*, budget séparé, hors budget prod), jamais learnSupplierProfile ni tables métier. Why: mesurer les modèles sans effet de bord.
- Domain rules (stock, parts, WinMotor, documents, tires) live in src/lib/AGENTS.md.
