import { createFileRoute } from "@tanstack/react-router";

/**
 * TEMPORAIRE — diagnostic de connectivité serveur vers IXELLIO.
 * GET /api/ixellio-test
 * Aucun identifiant, cookie ou jeton utilisateur n'est utilisé ni renvoyé.
 * Ne renvoie jamais le HTML complet ni d'en-têtes sensibles.
 */
export const Route = createFileRoute("/api/ixellio-test")({
  server: {
    handlers: {
      GET: async () => {
        const target = "https://www.ixellio.fr/ident.html?method=searchByImmat";
        const started = Date.now();
        try {
          const res = await fetch(target, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "immat=AA123AA",
            redirect: "manual",
          });
          const text = await res.text();
          const durationMs = Date.now() - started;
          const lower = text.toLowerCase();
          const has = (s: string) => lower.includes(s.toLowerCase());

          return Response.json({
            ok: true,
            target,
            status: res.status,
            redirected: res.status >= 300 && res.status < 400,
            durationMs,
            contentType: res.headers.get("content-type"),
            bytes: text.length,
            looksLikeVehicleSearch:
              has("Information carte grise") || has("Code moteur") || has("VIN"),
            markers: {
              infoCarteGrise: has("Information carte grise"),
              codeMoteur: has("Code moteur"),
              vin: has("VIN"),
            },
            looksLikeLogin:
              has("mot de passe") ||
              has("password") ||
              has("connexion") ||
              has("identifiant") ||
              has("s'identifier") ||
              has("login"),
          });
        } catch (error) {
          return Response.json(
            {
              ok: false,
              target,
              durationMs: Date.now() - started,
              error: error instanceof Error ? error.message : "unknown error",
            },
            { status: 502 },
          );
        }
      },
    },
  },
});
