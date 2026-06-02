import { CalendarDays, FileText, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type TimelineMilestone = {
  weekLabel: string;
  description: string;
  estimatedDate: string;
  note: string;
};

export type TimelineDraft = {
  title: string;
  projectName: string;
  clientName: string;
  timelineDate: string;
  milestones: TimelineMilestone[];
  footerNote: string;
};

const DEFAULT_FOOTER =
  "Due to the nature of fluidity of this project, this timeline and start date is subject to change. Timeline may be changed based on any revisions necessary. Timeline may be changed based on Build, Client needs, and any other pertinent trade availability. Client is allowed two complimentary design revisions if necessary, after those two design revisions each revision will be $350.00.";

const DEFAULT_MILESTONES: TimelineMilestone[] = [
  {
    weekLabel: "Week X",
    description: "Deposit is paid; we are officially underway!",
    estimatedDate: "",
    note: "",
  },
  {
    weekLabel: "Week Two",
    description: "Conceptual Design In Person. Inspiration, Materiality Direction for each space of the home.",
    estimatedDate: "",
    note: "",
  },
  {
    weekLabel: "Week Seven",
    description: "Design Presentation: 3D Renderings and Fixtures + Finishes Selections for all spaces.",
    estimatedDate: "",
    note: "",
  },
  {
    weekLabel: "Week Nine",
    description: "All necessary revisions completed + Final Design Plan set. Drawings + Spec Schedule Creation Starts.",
    estimatedDate: "",
    note: "",
  },
  {
    weekLabel: "Week Twelve",
    description: "Drawings + Specifications Delivered.",
    estimatedDate: "",
    note: "Final Payment Due.",
  },
];

export function TimelineCreator({
  projectId = null,
  defaultProjectName = "",
  defaultClientName = "",
  buttonLabel = "Create New Timeline",
  helperText = "Create the service timeline before the project officially starts. You can attach it when the project is created.",
  onSaved,
}: {
  projectId?: string | null;
  defaultProjectName?: string;
  defaultClientName?: string;
  buttonLabel?: string;
  helperText?: string;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<TimelineDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const startTimeline = () => {
    setDraft({
      title: "Tentative Service Timeline",
      projectName: defaultProjectName,
      clientName: defaultClientName,
      timelineDate: new Date().toISOString().slice(0, 10),
      milestones: DEFAULT_MILESTONES,
      footerNote: DEFAULT_FOOTER,
    });
  };

  const updateDraft = (patch: Partial<TimelineDraft>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
  };

  const updateMilestone = (index: number, patch: Partial<TimelineMilestone>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      milestones: draft.milestones.map((milestone, i) => i === index ? { ...milestone, ...patch } : milestone),
    });
  };

  const addMilestone = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      milestones: [...draft.milestones, { weekLabel: "Week", description: "", estimatedDate: "", note: "" }],
    });
  };

  const removeMilestone = (index: number) => {
    if (!draft) return;
    setDraft({
      ...draft,
      milestones: draft.milestones.filter((_, i) => i !== index),
    });
  };

  const saveTimeline = async () => {
    if (!draft) return;
    if (!draft.projectName.trim() && !draft.clientName.trim()) {
      return toast.error("Add a project name or client name first.");
    }
    setSaving(true);
    try {
      const html = buildTimelineHtml(draft);
      await db.createProjectTimeline({
        project_id: projectId,
        title: draft.title.trim() || "Tentative Service Timeline",
        project_name: draft.projectName.trim() || null,
        client_name: draft.clientName.trim() || null,
        timeline_date: draft.timelineDate || null,
        html_data_url: htmlDataUrl(html),
        raw_text: JSON.stringify({ type: "project_timeline", ...draft }),
      });
      toast.success(projectId ? "Timeline saved to project" : "Timeline saved. Attach it when you create the project.");
      setDraft(null);
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message || "Could not save timeline.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full">
      {!draft && (
        <button type="button" onClick={startTimeline} className="inline-flex w-full sm:w-auto justify-center items-center gap-2 px-6 py-3 border border-ink text-ink text-sm tracking-wide hover:bg-ink hover:text-primary-foreground transition-colors">
          <Plus className="w-4 h-4" /> {buttonLabel}
        </button>
      )}

      {draft && (
        <section className="border border-border p-6 mt-6 bg-bone/20">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <div className="eyebrow mb-2">Service Timeline</div>
              <h2 className="font-display text-3xl">Create Timeline</h2>
              <p className="text-sm text-muted-foreground mt-2">{helperText}</p>
            </div>
            <button onClick={() => setDraft(null)} className="text-muted-foreground hover:text-ink"><X className="w-5 h-5" /></button>
          </div>

          <div className="space-y-8">
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ReviewField label="Timeline Title" value={draft.title} onChange={(value) => updateDraft({ title: value })} />
                <ReviewField label="Timeline Date" type="date" value={draft.timelineDate} onChange={(value) => updateDraft({ timelineDate: value })} />
                <ReviewField label="Project Name" value={draft.projectName} onChange={(value) => updateDraft({ projectName: value })} />
                <ReviewField label="Client Name" value={draft.clientName} onChange={(value) => updateDraft({ clientName: value })} />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="eyebrow mb-1">Milestones</div>
                    <p className="text-sm text-muted-foreground">Add the week, date, and client-facing milestone details.</p>
                  </div>
                  <button type="button" onClick={addMilestone} className="inline-flex items-center gap-2 px-3 py-2 border border-border text-sm hover:border-ink">
                    <Plus className="w-4 h-4" /> Add Row
                  </button>
                </div>

                {draft.milestones.map((milestone, index) => (
                  <div key={index} className="border border-border bg-background p-4">
                    <div className="grid grid-cols-1 md:grid-cols-[150px_1fr_170px_42px] gap-3 items-start">
                      <ReviewField label="Week" value={milestone.weekLabel} onChange={(value) => updateMilestone(index, { weekLabel: value })} />
                      <div>
                        <Label className="eyebrow">Description</Label>
                        <Textarea value={milestone.description} onChange={(e) => updateMilestone(index, { description: e.target.value })} rows={2} />
                      </div>
                      <ReviewField label="Estimated Date" type="date" value={milestone.estimatedDate} onChange={(value) => updateMilestone(index, { estimatedDate: value })} />
                      <button type="button" onClick={() => removeMilestone(index)} className="mt-6 inline-flex h-10 w-10 items-center justify-center border border-border text-muted-foreground hover:border-destructive hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-3">
                      <ReviewField label="Payment / Extra Note" value={milestone.note} onChange={(value) => updateMilestone(index, { note: value })} />
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <Label className="eyebrow">Timeline Note</Label>
                <Textarea value={draft.footerNote} onChange={(e) => updateDraft({ footerNote: e.target.value })} rows={5} />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <button type="button" onClick={() => printTimelineDraft(draft)} className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-border text-sm hover:border-ink">
                  <FileText className="w-4 h-4" /> Download PDF
                </button>
                <button onClick={saveTimeline} disabled={saving} className="px-6 py-3 bg-ink text-primary-foreground text-sm disabled:opacity-50">
                  {saving ? "Saving..." : "Save Timeline"}
                </button>
              </div>
            </div>

            <TimelinePreview draft={draft} />
          </div>
        </section>
      )}
    </div>
  );
}

function ReviewField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div>
      <Label className="eyebrow">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function TimelinePreview({ draft }: { draft: TimelineDraft }) {
  return (
    <div className="self-start">
      <div className="eyebrow mb-3">Live Preview</div>
      <div className="bg-white border border-border p-8 text-black shadow-sm overflow-hidden">
        <TimelineDocument draft={draft} />
      </div>
    </div>
  );
}

function TimelineDocument({ draft }: { draft: TimelineDraft }) {
  return (
    <div className="font-serif">
      <div className="text-center mb-10">
        <div className="font-display text-[40px] sm:text-[54px] leading-none tracking-[-0.06em]">MERAV INTERIORS</div>
        <div className="mt-3 text-[12px] tracking-[0.42em] text-neutral-500 font-sans">BY KATIE ROBERTS</div>
      </div>
      <div className="text-center mb-8">
        <div className="text-[11px] tracking-[0.28em] uppercase text-neutral-500 font-sans">{draft.projectName || draft.clientName || "Project"}</div>
        <h3 className="mt-3 text-3xl font-bold uppercase">{draft.title || "Tentative Service Timeline"}</h3>
        {draft.timelineDate && <p className="mt-2 text-sm text-neutral-500 font-sans">{formatDisplayDate(draft.timelineDate)}</p>}
      </div>
      <div className="space-y-5">
        {draft.milestones.map((milestone, index) => (
          <div key={index} className="border-t border-black pt-4">
            <div className="text-lg font-bold uppercase">{milestone.weekLabel || `Week ${index + 1}`}:</div>
            <p className="mt-1 text-[15px] leading-relaxed">
              {milestone.description || "Timeline milestone"}
              {milestone.estimatedDate ? <><span> Estimated Date: </span><strong>{formatDisplayDate(milestone.estimatedDate)}.</strong></> : null}
              {milestone.note ? <><span> </span><strong>{milestone.note}</strong></> : null}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-10 border-t border-black pt-4 text-[12px] leading-relaxed">{draft.footerNote}</p>
    </div>
  );
}

export function timelineFromRaw(rawText: string | null): TimelineDraft | null {
  if (!rawText) return null;
  try {
    const raw = JSON.parse(rawText) as Partial<TimelineDraft> & { type?: string };
    if (raw.type !== "project_timeline") return null;
    return {
      title: raw.title || "Tentative Service Timeline",
      projectName: raw.projectName || "",
      clientName: raw.clientName || "",
      timelineDate: raw.timelineDate || "",
      milestones: Array.isArray(raw.milestones) ? raw.milestones.map((milestone) => ({
        weekLabel: milestone.weekLabel || "",
        description: milestone.description || "",
        estimatedDate: milestone.estimatedDate || "",
        note: milestone.note || "",
      })) : [],
      footerNote: raw.footerNote || DEFAULT_FOOTER,
    };
  } catch {
    return null;
  }
}

export function printTimelineDraft(draft: TimelineDraft) {
  printHtmlAsPdf(buildTimelineHtml(draft), `${draft.projectName || draft.clientName || "Project"} Timeline`);
}

function buildTimelineHtml(draft: TimelineDraft) {
  const milestoneHtml = draft.milestones.map((milestone, index) => `
    <section class="milestone">
      <h2>${escapeHtml(milestone.weekLabel || `Week ${index + 1}`)}:</h2>
      <p>
        ${escapeHtml(milestone.description || "Timeline milestone")}
        ${milestone.estimatedDate ? ` Estimated Date: <strong>${escapeHtml(formatDisplayDate(milestone.estimatedDate))}.</strong>` : ""}
        ${milestone.note ? ` <strong>${escapeHtml(milestone.note)}</strong>` : ""}
      </p>
    </section>
  `).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(draft.projectName || draft.clientName || "Project Timeline")}</title>
  <style>
    @page { size: letter; margin: 0.55in; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #000; background: #fff; }
    .page { min-height: 10in; box-sizing: border-box; }
    .brand { text-align: center; margin-bottom: 0.65in; }
    .logo { font-size: 58px; line-height: 0.95; letter-spacing: -0.08em; font-weight: 400; }
    .byline { margin-top: 16px; font-family: Arial, sans-serif; letter-spacing: 0.45em; color: #999; font-size: 14px; }
    .project { text-align: center; margin-bottom: 0.42in; }
    .project-name { font-family: Arial, sans-serif; letter-spacing: 0.28em; text-transform: uppercase; color: #777; font-size: 11px; }
    h1 { margin: 0.12in 0 0; text-align: center; font-size: 30px; text-transform: uppercase; }
    .timeline-date { margin-top: 0.08in; font-family: Arial, sans-serif; color: #777; font-size: 12px; }
    .milestone { border-top: 1px solid #000; padding-top: 0.16in; margin-top: 0.22in; }
    .milestone h2 { margin: 0; font-size: 18px; text-transform: uppercase; }
    .milestone p { margin: 0.06in 0 0; font-size: 15px; line-height: 1.45; }
    .note { border-top: 1px solid #000; margin-top: 0.45in; padding-top: 0.15in; font-size: 12px; line-height: 1.45; }
  </style>
</head>
<body>
  <main class="page">
    <section class="brand">
      <div class="logo">MERAV INTERIORS</div>
      <div class="byline">BY KATIE ROBERTS</div>
    </section>
    <section class="project">
      <div class="project-name">${escapeHtml(draft.projectName || draft.clientName || "Project")}</div>
      <h1>${escapeHtml(draft.title || "Tentative Service Timeline")}</h1>
      ${draft.timelineDate ? `<div class="timeline-date">${escapeHtml(formatDisplayDate(draft.timelineDate))}</div>` : ""}
    </section>
    ${milestoneHtml}
    <p class="note">${escapeHtml(draft.footerNote)}</p>
  </main>
</body>
</html>`;
}

function htmlDataUrl(html: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function formatDisplayDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function printHtmlAsPdf(html: string, fileName?: string | null) {
  const target = window.open("", "_blank");
  if (!target) {
    toast.error("Allow popups to download the timeline PDF.");
    return;
  }
  target.document.open();
  target.document.write(html);
  target.document.close();
  target.document.title = pdfFileName(fileName);
  const printWhenReady = () => {
    target.focus();
    target.print();
  };
  if (target.document.readyState === "complete") {
    window.setTimeout(printWhenReady, 250);
  } else {
    target.addEventListener("load", () => window.setTimeout(printWhenReady, 250), { once: true });
  }
}

function pdfFileName(fileName?: string | null) {
  const safeName = (fileName || "Timeline").replace(/\.(html?|pdf)$/i, "").trim() || "Timeline";
  return `${safeName}.pdf`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
