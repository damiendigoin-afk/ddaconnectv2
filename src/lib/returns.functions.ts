import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const mailInput = z.object({
  returnId: z.string().uuid(),
  kind: z.enum(["accord", "expedition", "reception", "relance", "escalade"]),
  to: z.string().email().optional(),
  extra: z.string().max(2000).optional(),
});

/** Envoi d'un e-mail fournisseur lié à un dossier de retour (avec lien sécurisé). */
export const sendReturnMailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => mailInput.parse(data))
  .handler(async ({ data }) => {
    const { runReturnMail } = await import("./returns-workflow.server");
    return runReturnMail(data);
  });

const tokenInput = z.object({ token: z.string().min(20).max(80) });

/** Portail fournisseur : lecture du dossier via lien sécurisé (aucun compte requis). */
export const getSharedReturnFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => tokenInput.parse(data))
  .handler(async ({ data }) => {
    const { getSharedReturn } = await import("./returns-workflow.server");
    return getSharedReturn(data.token);
  });

const answerInput = z.object({
  token: z.string().min(20).max(80),
  answer: z.enum(["accepte", "refuse", "info", "non_concerne", "en_cours", "recu", "non_recu", "partiel", "probleme"]),
  comment: z.string().max(2000).optional(),
  creditNumber: z.string().max(60).optional(),
  creditAmount: z.number().min(0).max(1000000).optional(),
  file: z
    .object({
      name: z.string().max(160),
      mimeType: z.string().max(80),
      dataBase64: z.string().max(8_000_000),
    })
    .optional(),
});

/** Portail fournisseur : réponse et dépôt de document. */
export const submitSharedReturnAnswerFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => answerInput.parse(data))
  .handler(async ({ data }) => {
    const { submitSharedAnswer } = await import("./returns-workflow.server");
    return submitSharedAnswer(data);
  });

/** Relances automatiques et escalades des retours en attente. */
export const runReturnFollowupsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { runReturnFollowups } = await import("./returns-workflow.server");
    return runReturnFollowups();
  });
