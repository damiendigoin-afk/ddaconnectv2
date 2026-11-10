import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { auditReportAuth } from "./report-auth";

const input = z.object({
  expertiseId: z.string().uuid(),
  to: z.string().email(),
  message: z.string().max(2000).optional(),
  origin: z.string().url(),
});

export const sendExpertiseReport = createServerFn({ method: "POST" })
  .middleware([auditReportAuth, requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { sendExpertiseReportEmail } = await import("./expertise-email.server");
    const res = await sendExpertiseReportEmail({
      expertiseId: data.expertiseId,
      to: data.to,
      origin: data.origin,
      actor: { userId: context.userId, supabase: context.supabase },
      ...(data.message ? { message: data.message } : {}),
    });
    return { ok: res.ok, error: res.error ?? "", code: res.code ?? "", status: res.status ?? 200 };
  });
