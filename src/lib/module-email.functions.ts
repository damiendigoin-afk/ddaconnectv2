import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  kind: z.string().min(1).max(40),
  links: z.array(z.object({ label: z.string().max(120), url: z.string().url() })).max(10).optional(),
});

export const sendModuleEmailFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { sendModuleEmail } = await import("./module-email.server");
    return sendModuleEmail({
      to: data.to,
      subject: data.subject,
      body: data.body,
      kind: data.kind,
      ...(data.links ? { links: data.links } : {}),
    });
  });
