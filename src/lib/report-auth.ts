import { createMiddleware } from "@tanstack/react-start";

/** Wrap the managed auth middleware so even pre-handler rejection is logged. */
export const auditReportAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unauthorized:")) {
      console.error("[report-email]", {
        stage: "authentication",
        code: "unauthenticated",
        status: 401,
      });
      throw new Response("Connectez-vous pour envoyer ce compte rendu", { status: 401 });
    }
    console.error("[report-email]", { stage: "endpoint", code: "request_failed" });
    throw error;
  }
});
