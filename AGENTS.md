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
- Browser-only CommonJS libs (tesseract.js, qrcode) are imported lazily behind `if (import.meta.env.SSR)` guards. Why: their presence in the server bundle emits a top-level createRequire that crashed the published server (502).
- Storage uploads with upsert:false go through src/lib/storage-retry.ts (uploadWithRetry). Why: transient 429/503 from the file service must not surface raw to users or create duplicates.
- Districash: per-site credentials in integration_credentials (provider `districash:<siteId>`), per-site default tire supplier in tire_supplier_site_settings; no network connector until portal auth is documented (parser in src/lib/districash.ts is test-only). Never call /rest/xat2v2. Why: no validated autonomous API.
- Bodyshop case ↔ customer/vehicle records are created or linked only on user click via src/lib/bodyshop-link.ts (duplicate check by plate/VIN/WinMotor account/name+contacts, link only when the case field is still NULL). Why: avoid duplicate records and silent case mutations.

- Districash cart: server-side add (POST /cart/store via assertCartPath, one send, explicit confirmation) fills the cart of the account of the ORDER's site; districash-cart.functions checks requested site = order site, user_can_access_site and account mapping (checkCartSiteBinding) and never falls back to another site. /cart/order, /cart/payment, /order/* forbidden. The extension in extension/districash-prefill is optional and only prefills reference/plate. Why: no supplier order, no cross-garage cart.
