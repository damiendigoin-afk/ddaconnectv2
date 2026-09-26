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
