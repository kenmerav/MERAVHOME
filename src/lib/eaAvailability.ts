// Keep historical EA data, but stop its agent, tasks, drafts and briefings.
// Construction-document filing has its own authenticated controls and schedule.
export const EA_AGENT_ENABLED = false;

export function eaRetiredResponse() {
  return Response.json(
    {
      error: "The EA Desk has been retired. Automatic construction-document uploads remain active.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
