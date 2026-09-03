import { createFileRoute } from "@tanstack/react-router";

/**
 * Vérifie qu'un service externe est configuré côté serveur.
 * N'expose jamais la clé : uniquement présence + 4 derniers caractères.
 */
const SECRETS: Record<string, string> = {
  ocr: "LOVABLE_API_KEY",
  email: "RESEND_API_KEY",
  stockage: "SUPABASE_URL",
  geocodage: "GEOCODING_API_KEY",
};

export const Route = createFileRoute("/api/public/api-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const service = new URL(request.url).searchParams.get("service") ?? "";
        const name = SECRETS[service];
        if (!name) {
          return Response.json({ ok: false, message: "Service inconnu" }, { status: 400 });
        }
        const value = process.env[name];
        if (!value) {
          return Response.json({
            ok: false,
            message: `Clé ${name} absente : le service reste utilisable en manuel.`,
            hint: null,
          });
        }
        return Response.json({
          ok: true,
          message: `Clé ${name} configurée.`,
          hint: value.slice(-4),
        });
      },
    },
  },
});
