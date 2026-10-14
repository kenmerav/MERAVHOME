import type { BathroomPlanEvidence } from "./materialSuggestions";

export function cleanBathroomPlanEvidence(value: unknown, rooms: { id: string; name: string }[], pages: number): BathroomPlanEvidence[] {
  const rows = Array.isArray(value) ? value : [];
  return rooms.map(room => {
    const matches = rows.filter(row => row?.room_id === room.id);
    const row = matches.length === 1 ? matches[0] : null;
    const page = Number.isInteger(row?.page) && row.page > 0 && row.page <= pages ? row.page : null;
    const evidence = typeof row?.evidence === "string" ? row.evidence.trim().slice(0, 1200) : "";
    const confidence = ["high", "medium", "low"].includes(row?.confidence) ? row.confidence : "low";
    const supported = page !== null && !!evidence && confidence === "high";
    const shower = supported && row?.shower === "present" ? "present" :
      supported && row?.shower === "absent" && row?.complete_layout === true ? "absent" : "unknown";
    return { room_id: room.id, shower, confidence, page,
      sheet: typeof row?.sheet === "string" ? row.sheet.trim().slice(0, 100) : "", evidence };
  });
}
