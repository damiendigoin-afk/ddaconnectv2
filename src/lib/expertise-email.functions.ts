import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  expertiseId: z.string().uuid(),
  to: z.string().email(),
  message: z.string().max(2000).optional(),
  origin: z.string().url(),
});

export const sendExpertiseReport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { sendExpertiseReportEmail } = await import("./expertise-email.server");
    const res = await sendExpertiseReportEmail({
      expertiseId: data.expertiseId,
      to: data.to,
      origin: data.origin,
      ...(data.message ? { message: data.message } : {}),
    });
    return { ok: res.ok, error: res.error ?? "" };
  });