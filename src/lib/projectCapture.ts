export type ProjectCaptureActionItem = {
  text: string;
  owner: string | null;
  due_date: string | null;
};

export type ProjectCaptureAnalysis = {
  summary: string;
  transcription: string;
  visual_notes: string[];
  decisions: string[];
  changes_requested: string[];
  action_items: ProjectCaptureActionItem[];
  open_questions: string[];
};

function strings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

export function normalizeProjectCaptureAnalysis(value: unknown): ProjectCaptureAnalysis {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const actionItems = Array.isArray(raw.action_items) ? raw.action_items : [];
  return {
    summary: String(raw.summary || "").trim(),
    transcription: String(raw.transcription || raw.transcript || "").trim(),
    visual_notes: strings(raw.visual_notes),
    decisions: strings(raw.decisions),
    changes_requested: strings(raw.changes_requested),
    action_items: actionItems
      .map((item) => {
        if (typeof item === "string") {
          return { text: item.trim(), owner: null, due_date: null };
        }
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const dueDate = String(row.due_date || "").trim();
        return {
          text: String(row.text || row.title || "").trim(),
          owner: String(row.owner || "").trim() || null,
          due_date: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null,
        };
      })
      .filter((item) => item.text),
    open_questions: strings(raw.open_questions),
  };
}

export function formatProjectCaptureKnowledge(
  analysis: ProjectCaptureAnalysis,
  options: { kind: "voice" | "notes"; rawTranscript?: string },
) {
  const sections: string[] = [];
  const addList = (label: string, items: string[]) => {
    if (items.length) sections.push(`${label}:\n${items.map((item) => `- ${item}`).join("\n")}`);
  };

  if (analysis.summary) sections.push(`Meeting summary:\n${analysis.summary}`);
  addList("Decisions", analysis.decisions);
  addList("Changes requested", analysis.changes_requested);
  if (analysis.action_items.length) {
    sections.push(
      `Action items:\n${analysis.action_items
        .map(
          (item) =>
            `- ${item.text}${item.owner ? ` (Owner: ${item.owner})` : ""}${item.due_date ? ` (Due: ${item.due_date})` : ""}`,
        )
        .join("\n")}`,
    );
  }
  addList("Open questions", analysis.open_questions);
  if (options.kind === "notes") addList("Sketches and visual notes", analysis.visual_notes);

  const transcript = (analysis.transcription || options.rawTranscript || "").trim();
  if (transcript) {
    sections.push(
      `${options.kind === "voice" ? "Voice memo transcript" : "Handwritten notes transcription"}:\n${transcript}`,
    );
  }
  return sections.join("\n\n").trim();
}
