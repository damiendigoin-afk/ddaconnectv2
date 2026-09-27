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
- Phase B stock: stock levels are derived only from `stock_movements` deltas (view `stock_levels`); rules live in src/lib/parts-rules.ts. Why: traceable, physical-only stock, testable.
- WinMotor invoices: imported only via SECURITY DEFINER RPCs wm_* (site chosen explicitly, OR identity = site + or_number, or_sale_final once per link). Why: WinMotor primacy, idempotent re-imports, traceable stock.
- Supplier real cost: invoice lines link to receipt lines via supplier_cost_lines (src/lib/supplier-cost.ts); only valuation (PAMP, last PA, unit_cost_real) changes, never quantities. Why: physical stock ≠ financial documents, idempotent re-control.
- Pièces & achats follows the global active site (TopBar ActivePicker → usePartsCtx writeSite/readSite, rules in src/lib/parts-site.ts); no per-screen site selectors. Why: one site at a time, never write silently on the other company.
- Measures: all measure display/save goes through src/lib/measure.ts (NaN/Infinity/empty/non-numeric => null). Why: "NaN mm" leaked into reports.
- tslib pinned to ^2 via package.json overrides. Why: pdf-lib with tslib 1.x crashed in the server bundle (__extends/__toESM).
