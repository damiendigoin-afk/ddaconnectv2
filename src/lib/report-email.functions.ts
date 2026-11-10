import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { auditReportAuth } from "./report-auth";

const input = z.object({
  inspectionId: z.string().uuid(),
  to: z.string().email(),
  message: z.string().max(2000).optional(),
  origin: z.string().url(),
});

export const sendTourReport = createServerFn({ method: "POST" })
  .middleware([auditReportAuth, requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { sendTourReportEmail } = await import("./report-email.server");
    const res = await sendTourReportEmail({
      inspectionId: data.inspectionId,
      to: data.to,
      origin: data.origin,
      actor: { userId: context.userId, supabase: context.supabase },
      ...(data.message ? { message: data.message } : {}),
    });
    return { ok: res.ok, error: res.error ?? "", code: res.code ?? "", status: res.status ?? 200 };
  });
