import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  inspectionId: z.string().uuid(),
  to: z.string().email(),
  message: z.string().max(2000).optional(),
  origin: z.string().url(),
});

export const sendTourReport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { sendTourReportEmail } = await import("./report-email.server");
    const res = await sendTourReportEmail({
      inspectionId: data.inspectionId,
      to: data.to,
      origin: data.origin,
      ...(data.message ? { message: data.message } : {}),
    });
    return { ok: res.ok, error: res.error ?? "" };
  });
