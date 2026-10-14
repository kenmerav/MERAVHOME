import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MaterialCatalogSuggestions } from "@/components/MaterialCatalogSuggestions";
import { completionPossibleItems } from "@/lib/specCompletionCatalog";
import { fetchMaterialPlanCheck } from "@/lib/materialPlanCheck";
import type { MaterialItem } from "@/lib/db";
import type { CompletionRoom, SpecCompletionReport } from "@/lib/specCompletion";

export function SpecCompletionPossibleItems({ projectId, rooms, items, document, disabled, onAdded }: {
  projectId: string; rooms: CompletionRoom[]; items: MaterialItem[];
  document: SpecCompletionReport["document"]; disabled: boolean; onAdded: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ["materialPlanCheck", projectId, document?.id, document?.updated_at,
      rooms.filter(room => /bath|powder/i.test(room.name)).map(room => `${room.id}:${room.name}`).sort().join("|")],
    queryFn: () => fetchMaterialPlanCheck(projectId, document!.id),
    enabled: open && !!document && rooms.some(room => /bath|powder/i.test(room.name)),
    staleTime: 24 * 60 * 60 * 1000, retry: false, refetchOnWindowFocus: false,
  });
  const room = rooms.find(room => room.id === roomId) ?? rooms[0];
  const evidence = plan.data?.document?.id === document?.id ? plan.data?.rooms.find(row => row.room_id === room?.id) : undefined;
  const suggestions = room ? completionPossibleItems(room, rooms, items, evidence) : [];
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" disabled={disabled || !rooms.length} className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 disabled:opacity-50">Review possible items</button></DialogTrigger>
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-normal">Possible items for your rooms</DialogTitle>
        <DialogDescription>Review optional room items and choose products from your catalog. Selections in Materials Throughout are included.</DialogDescription>
      </DialogHeader>
      <label className="text-xs">Room
        <select aria-label="Room for possible items" value={room?.id ?? ""} onChange={event => setRoomId(event.target.value)} className="mt-1 block w-full border bg-background px-3 py-2 text-sm">
          {rooms.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
      {plan.isFetching && <p role="status" className="text-xs text-muted-foreground">Checking bathroom layouts against the latest plans…</p>}
      {(plan.error || plan.data?.status === "unavailable") && <p role="status" className="text-xs text-amber-900">Bathroom layout could not be confirmed. Review shower suggestions against the plans.</p>}
      <p className="text-xs text-muted-foreground">These are possibilities to review, not additional completion issues. Catalog choices save to Materials and the Spec Book with quantity TBD.</p>
      <div className="divide-y border">
        {room && suggestions.map(suggestion => <div key={suggestion.label} className="flex items-center justify-between gap-4 p-4">
          <div><p className="font-medium">{suggestion.label}</p><p className="text-xs text-muted-foreground">{suggestion.category}</p></div>
          <MaterialCatalogSuggestions projectId={projectId} roomId={room.id} roomName={room.name} label={suggestion.label} existingItem={suggestion.existingItem} disabled={disabled || plan.isFetching} considerShared
            onAdded={async () => { await qc.invalidateQueries({ queryKey: ["materialItems", projectId] }); await onAdded(); }} />
        </div>)}
        {!suggestions.length && <p className="p-4 text-sm text-muted-foreground">No additional template items to review for this room.</p>}
      </div>
      {room && <a className="text-xs underline" href={`/projects/${projectId}/materials?roomId=${room.id}#materials-room-${room.id}`} target="_blank" rel="noreferrer">Add a custom item or product link in Materials ↗</a>}
    </DialogContent>
  </Dialog>;
}
