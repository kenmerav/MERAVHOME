import { createFileRoute } from "@tanstack/react-router";
import { fullSpecBudgetRequest } from "@/lib/fullSpecBudgetApi.server";

export const Route = createFileRoute("/api/full-spec-budget")({ server: { handlers: {
  POST: async ({ request }) => fullSpecBudgetRequest(request),
} } });
