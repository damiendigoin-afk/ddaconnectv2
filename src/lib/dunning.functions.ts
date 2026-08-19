import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const input = z.object({
  caseId: z.string().uuid(),
  to: z.string().email(),
  message: z.string().max(2000).optional(),
  authorName: z.string().max(120).optional(),
});

/** Relance de créance sur un dossier carrosserie (managers/salariés connectés). */
export const sendReceivableReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { sendDunningEmail } = await import("./dunning.server");
    const res = await sendDunningEmail({
      caseId: data.caseId,
      to: data.to,
      ...(data.message ? { message: data.message } : {}),
      ...(data.authorName ? { authorName: data.authorName } : {}),
    });
    return { ok: res.ok, error: res.error ?? "", outstanding: res.outstanding };
  });
