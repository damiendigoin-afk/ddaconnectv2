import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/debug-tour-notify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id") ?? "";
        try {
          const { notifyTourCompleted } = await import("@/lib/tour-notify.server");
          const res = await notifyTourCompleted({ inspectionId: id, origin: url.origin });
          return Response.json({ res });
        } catch (e) {
          return Response.json({
            thrown: String(e),
            stack: e instanceof Error ? e.stack : null,
          });
        }
      },
    },
  },
});