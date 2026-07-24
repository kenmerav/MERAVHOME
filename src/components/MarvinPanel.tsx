import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ExternalLink,
  FileAudio,
  FileText,
  Link2,
  Loader2,
  Mail,
  MessageSquareText,
  Mic,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  MarvinBootstrap,
  MarvinMessage,
  MarvinProjectOption,
  MarvinSource,
  MarvinSuggestion,
} from "@/lib/marvin";
import { toast } from "sonner";

type MarvinTab = "briefing" | "chat" | "sources" | "review" | "settings";

export function MarvinPanel({ currentEmail }: { currentEmail: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<MarvinTab>("briefing");
  const query = useQuery({ queryKey: ["marvin"], queryFn: loadMarvin });
  const data = query.data;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["marvin"] });
  };

  if (query.isLoading) {
    return (
      <div className="py-20 text-sm text-muted-foreground">
        Marvin is gathering project context...
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {query.error instanceof Error ? query.error.message : "Marvin could not load."}
      </div>
    );
  }
  if (data?.setupNeeded) {
    return (
      <div className="border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        Apply the latest Marvin migration in Supabase before using Marvin.
      </div>
    );
  }
  if (!data) return null;

  const tabs: Array<[MarvinTab, string]> = [
    ["briefing", "Morning Briefing"],
    ["chat", "Chat"],
    ["sources", "Sources"],
    ["review", `Review${data.review.length ? ` (${data.review.length})` : ""}`],
    ["settings", "Settings"],
  ];

  return (
    <section className="border border-border bg-white">
      <header className="flex flex-col gap-4 border-b border-border px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center bg-ink text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-3xl">Marvin</h2>
            <p className="text-xs text-muted-foreground">
              Private project intelligence for Ken and Katie
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-9 w-9 items-center justify-center border border-border"
          title="Refresh Marvin"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </header>

      <div className="flex overflow-x-auto border-b border-border px-3" role="tablist">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-xs uppercase tracking-[0.14em] ${tab === value ? "border-ink text-ink" : "border-transparent text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-4 md:p-6">
        {tab === "briefing" ? (
          <BriefingView data={data} onChanged={refresh} />
        ) : tab === "chat" ? (
          <ChatView projects={data.projects} conversations={data.conversations} />
        ) : tab === "sources" ? (
          <SourcesView data={data} onChanged={refresh} />
        ) : tab === "review" ? (
          <ReviewView sources={data.review} projects={data.projects} onChanged={refresh} />
        ) : (
          <SettingsView data={data} currentEmail={currentEmail} onChanged={refresh} />
        )}
      </div>
    </section>
  );
}

function BriefingView({
  data,
  onChanged,
}: {
  data: MarvinBootstrap;
  onChanged: () => Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      await marvinRequest({ action: "run_briefing" });
      await onChanged();
      toast.success("Morning briefing updated.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRunning(false);
    }
  };
  const items = data.briefing?.content?.items ?? [];
  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow mb-1">Today</div>
          <h3 className="font-display text-3xl">Your Morning Briefing</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.briefing?.content?.summary || "Run the briefing to build today's priorities."}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2.5 text-sm text-white disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Briefing Now
        </button>
      </div>

      {items.length ? (
        <div className="divide-y divide-border border-y border-border">
          {items.map((item, index) => (
            <div
              key={`${item.projectId}-${index}`}
              className="grid gap-2 py-4 md:grid-cols-[180px_100px_1fr]"
            >
              <div className="text-sm font-medium">{item.projectName}</div>
              <div>
                <PriorityLabel value={item.priority} />
              </div>
              <div>
                <div className="text-sm">{item.nextAction}</div>
                <div className="mt-1 text-xs text-muted-foreground">{item.reason}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine text="No briefing priorities yet." />
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="eyebrow mb-1">Review Before Creating</div>
            <h3 className="font-display text-2xl">Suggested Tasks</h3>
          </div>
          <span className="text-xs text-muted-foreground">
            Nothing becomes a task without approval
          </span>
        </div>
        {data.suggestions.length ? (
          <div className="divide-y divide-border border-y border-border">
            {data.suggestions.map((suggestion) => (
              <SuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                employees={data.employees}
                onChanged={onChanged}
              />
            ))}
          </div>
        ) : (
          <EmptyLine text="No new task suggestions require review." />
        )}
      </div>
    </div>
  );
}

function SuggestionRow({
  suggestion,
  employees,
  onChanged,
}: {
  suggestion: MarvinSuggestion;
  employees: MarvinBootstrap["employees"];
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState(suggestion.title);
  const [notes, setNotes] = useState(suggestion.notes ?? "");
  const [assigneeId, setAssigneeId] = useState(suggestion.recommended_assignee_id ?? "");
  const [dueDate, setDueDate] = useState(suggestion.due_date ?? "");
  const [priority, setPriority] = useState(suggestion.priority);
  const [estimatedHours, setEstimatedHours] = useState(
    suggestion.estimated_hours === null || suggestion.estimated_hours === undefined
      ? ""
      : String(suggestion.estimated_hours),
  );
  const [busy, setBusy] = useState(false);
  const act = async (action: "approve_suggestion" | "dismiss_suggestion") => {
    setBusy(true);
    try {
      await marvinRequest({
        action,
        id: suggestion.id,
        title,
        notes,
        assigned_user_id: assigneeId || null,
        due_date: dueDate || null,
        priority,
        estimated_hours: estimatedHours === "" ? null : Number(estimatedHours),
      });
      await onChanged();
      toast.success(action === "approve_suggestion" ? "Task created." : "Suggestion dismissed.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.12em]">
              {suggestion.project_name}
            </span>
            <PriorityLabel value={priority} />
            {suggestion.required_capability ? (
              <span className="text-xs text-muted-foreground">
                {suggestion.required_capability}
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">{suggestion.reason}</div>
          {suggestion.source ? (
            <a
              href={suggestion.source.source_url || "#"}
              target={suggestion.source.source_url ? "_blank" : undefined}
              rel={suggestion.source.source_url ? "noreferrer" : undefined}
              className="mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-2"
              onClick={(event) => {
                if (!suggestion.source?.source_url) event.preventDefault();
              }}
            >
              {suggestion.source.title}
              {suggestion.source.source_url ? <ExternalLink className="h-3 w-3" /> : null}
            </a>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => act("approve_suggestion")}
            disabled={busy || !title.trim()}
            className="inline-flex items-center gap-2 border border-ink bg-ink px-3 py-2 text-xs text-white disabled:opacity-50"
            title="Approve and create task"
          >
            <Check className="h-4 w-4" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => act("dismiss_suggestion")}
            disabled={busy}
            className="inline-flex h-9 w-9 items-center justify-center border border-border"
            title="Dismiss suggestion"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(240px,2fr)_minmax(180px,1fr)_140px_120px_110px]">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Task
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-10 border border-border px-3 text-sm text-ink"
            aria-label="Suggested task title"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Assign to
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            className="h-10 border border-border bg-white px-3 text-sm text-ink"
            aria-label="Suggested task assignee"
          >
            <option value="">Leave unassigned</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.full_name || employee.email}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Due date
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="h-10 border border-border px-3 text-sm text-ink"
            aria-label="Suggested task due date"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Priority
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as MarvinSuggestion["priority"])}
            className="h-10 border border-border bg-white px-3 text-sm text-ink"
            aria-label="Suggested task priority"
          >
            {["Low", "Medium", "High", "Urgent"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Est. hours
          <input
            type="number"
            min="0"
            step="0.25"
            value={estimatedHours}
            onChange={(event) => setEstimatedHours(event.target.value)}
            className="h-10 border border-border px-3 text-sm text-ink"
            aria-label="Suggested task estimated hours"
          />
        </label>
      </div>

      <label className="mt-3 grid gap-1 text-xs text-muted-foreground">
        Instructions
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className="resize-y border border-border px-3 py-2 text-sm text-ink"
          aria-label="Suggested task instructions"
        />
      </label>
      <div className="mt-2 text-xs text-muted-foreground">
        {suggestion.assignee_reason ||
          "No assignee was named. Review the employee choice before approving."}
      </div>
    </div>
  );
}

function ChatView({
  projects,
  conversations,
}: {
  projects: MarvinProjectOption[];
  conversations: MarvinBootstrap["conversations"];
}) {
  const [projectId, setProjectId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<MarvinMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    marvinGet(`conversation_id=${encodeURIComponent(conversationId)}`)
      .then((body) => setMessages(body.messages ?? []))
      .catch((error) => toast.error(errorMessage(error)));
  }, [conversationId]);

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setSending(true);
    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      },
    ]);
    setDraft("");
    try {
      const body = await marvinRequest({
        action: "chat",
        project_id: projectId || null,
        conversation_id: conversationId || null,
        message,
      });
      setConversationId(body.conversationId);
      setMessages((current) => [...current, body.message]);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid min-h-[650px] gap-5 lg:grid-cols-[230px_1fr]">
      <aside className="border-r-0 border-border lg:border-r lg:pr-5">
        <button
          type="button"
          onClick={() => {
            setConversationId("");
            setMessages([]);
          }}
          className="mb-4 inline-flex w-full items-center justify-center gap-2 border border-ink px-3 py-2 text-sm"
        >
          <Plus className="h-4 w-4" /> New Chat
        </button>
        <div className="space-y-1">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => {
                setConversationId(conversation.id);
                setProjectId(conversation.project_id || "");
              }}
              className={`w-full px-3 py-2 text-left text-xs ${conversationId === conversation.id ? "bg-secondary font-medium" : "hover:bg-secondary/50"}`}
            >
              <span className="line-clamp-2">{conversation.title}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="mb-4 flex items-center gap-3 border-b border-border pb-4">
          <label
            className="text-xs uppercase tracking-[0.12em] text-muted-foreground"
            htmlFor="marvin-project"
          >
            Scope
          </label>
          <select
            id="marvin-project"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setConversationId("");
              setMessages([]);
            }}
            className="h-10 min-w-0 flex-1 border border-border bg-white px-3 text-sm"
          >
            <option value="">Portfolio - all projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.status === "Complete" ? " (Complete)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto py-3">
          {!messages.length && (
            <div className="mx-auto max-w-lg py-20 text-center">
              <MessageSquareText className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-4 font-display text-2xl">Ask Marvin about a project</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Answers use current Studio records plus confirmed emails, meetings, notes, and
                files. Drafts are copy-only.
              </p>
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "ml-auto max-w-2xl bg-secondary p-4"
                  : "max-w-3xl border-l-2 border-ink pl-4"
              }
            >
              <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
              {message.role === "assistant" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(message.content)}
                    className="inline-flex items-center gap-1.5 border border-border px-2 py-1 text-xs"
                  >
                    <Clipboard className="h-3 w-3" /> Copy
                  </button>
                  {(message.citations ?? []).map((citation, index) =>
                    citation.url ? (
                      <a
                        key={`${citation.title}-${index}`}
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs underline"
                      >
                        <Link2 className="h-3 w-3" /> {citation.title}
                      </a>
                    ) : (
                      <span
                        key={`${citation.title}-${index}`}
                        className="text-xs text-muted-foreground"
                      >
                        {citation.title}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Marvin is checking the evidence...
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-2 border-t border-border pt-4">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Ask about deadlines, decisions, commitments, materials, invoices, or draft a message..."
            className="min-h-20 flex-1 resize-none border border-border p-3 text-sm"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !draft.trim()}
            className="self-end border border-ink bg-ink px-4 py-3 text-sm text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function SourcesView({
  data,
  onChanged,
}: {
  data: MarvinBootstrap;
  onChanged: () => Promise<void>;
}) {
  const [sourceType, setSourceType] = useState<"note" | "transcript">("note");
  const [scope, setScope] = useState<"project" | "general">("project");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const addText = async () => {
    setBusy(true);
    try {
      await marvinRequest({
        action: "add_source",
        source_type: sourceType,
        project_ids: scope === "general" ? [] : projectIds,
        general_business: scope === "general",
        title,
        body_text: text,
      });
      setTitle("");
      setText("");
      await onChanged();
      toast.success("Source added to Marvin.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (scope === "project" && !projectIds.length)
      return toast.error("Choose at least one project first.");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("project_ids", JSON.stringify(scope === "general" ? [] : projectIds));
      form.set("general_business", String(scope === "general"));
      await marvinUpload(form);
      await onChanged();
      toast.success("Source uploaded to Marvin.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (scope === "project" && !projectIds.length)
      return toast.error("Choose at least one project first.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        uploadFile(
          new File([blob], `voice-memo-${new Date().toISOString().slice(0, 19)}.webm`, {
            type: blob.type,
          }),
        );
      };
      recorder.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access is required to record a voice memo.");
    }
  };

  const remove = async (id: string) => {
    try {
      await marvinRequest({ action: "delete_source", id });
      await onChanged();
      toast.success("Source deleted.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-1">Add Knowledge</div>
        <h3 className="font-display text-3xl">Project Sources</h3>
      </div>
      <div className="space-y-4 border-y border-border py-5">
        <SourceScopeSelector scope={scope} onChange={setScope} />
        {scope === "project" ? (
          <ProjectChecklist
            projects={data.projects}
            selected={projectIds}
            onChange={setProjectIds}
          />
        ) : (
          <div className="flex min-h-12 items-center gap-2 border border-border px-3 text-sm">
            <BriefcaseBusiness className="h-4 w-4" /> Business-wide knowledge
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as "note" | "transcript")}
            className="h-10 border border-border bg-white px-3 text-sm"
          >
            <option value="note">Note</option>
            <option value="transcript">Pasted transcript</option>
          </select>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Source title"
            className="h-10 border border-border px-3 text-sm"
          />
        </div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste notes or transcript..."
          className="min-h-28 w-full border border-border p-3 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addText}
            disabled={
              busy || !title.trim() || !text.trim() || (scope === "project" && !projectIds.length)
            }
            className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add to Marvin
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.txt,.md,audio/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadFile(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm"
          >
            <Upload className="h-4 w-4" /> Upload File
          </button>
          <button
            type="button"
            onClick={toggleRecording}
            disabled={busy}
            className={`inline-flex items-center gap-2 border px-4 py-2 text-sm ${recording ? "border-red-600 text-red-700" : "border-border"}`}
          >
            {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {recording ? "Stop Recording" : "Record Voice Memo"}
          </button>
        </div>
      </div>
      <div className="divide-y divide-border border-y border-border">
        {data.sources.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            projects={data.projects}
            onChanged={onChanged}
            onRemove={() => remove(source.id)}
          />
        ))}
        {!data.sources.length && <EmptyLine text="No project sources have been added yet." />}
      </div>
    </div>
  );
}

function SourceScopeSelector({
  scope,
  onChange,
}: {
  scope: "project" | "general";
  onChange: (scope: "project" | "general") => void;
}) {
  return (
    <div className="inline-flex border border-border" aria-label="Knowledge scope">
      <button
        type="button"
        onClick={() => onChange("project")}
        className={`px-4 py-2 text-sm ${scope === "project" ? "bg-ink text-white" : "bg-white"}`}
      >
        Project(s)
      </button>
      <button
        type="button"
        onClick={() => onChange("general")}
        className={`border-l border-border px-4 py-2 text-sm ${scope === "general" ? "bg-ink text-white" : "bg-white"}`}
      >
        General / Business
      </button>
    </div>
  );
}

function ProjectChecklist({
  projects,
  selected,
  onChange,
  likely = [],
}: {
  projects: MarvinProjectOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  likely?: string[];
}) {
  return (
    <div className="grid max-h-44 overflow-y-auto border border-border sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const checked = selected.includes(project.id);
        return (
          <label
            key={project.id}
            className="flex min-h-11 cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange(
                  checked ? selected.filter((id) => id !== project.id) : [...selected, project.id],
                )
              }
            />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {likely.includes(project.id) && (
              <span className="text-[10px] uppercase text-muted-foreground">Likely</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function candidateProjectIds(source: MarvinSource) {
  const candidates = source.metadata?.candidate_project_ids;
  const ids = Array.isArray(candidates)
    ? candidates.filter((value): value is string => typeof value === "string")
    : [];
  if (source.suggested_project_id && !ids.includes(source.suggested_project_id)) {
    ids.unshift(source.suggested_project_id);
  }
  return ids;
}

function sourceActionItemCount(source: MarvinSource) {
  return Array.isArray(source.metadata?.action_items) ? source.metadata.action_items.length : 0;
}

function SourceSummary({ source }: { source: MarvinSource }) {
  const [expanded, setExpanded] = useState(false);
  const summary = String(source.summary || "").trim();
  const actionCount = sourceActionItemCount(source);
  if (!summary && !actionCount) return null;
  const visible =
    expanded || summary.length <= 360 ? summary : `${summary.slice(0, 360).trim()}...`;
  return (
    <div className="mt-3 border-l-2 border-border pl-3">
      {summary && (
        <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{visible}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {actionCount > 0 && (
          <span>
            {actionCount} action item{actionCount === 1 ? "" : "s"}
          </span>
        )}
        {summary.length > 360 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 text-ink underline"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {expanded ? "Show less" : "Full summary"}
          </button>
        )}
      </div>
    </div>
  );
}

function SourceSegments({ source }: { source: MarvinSource }) {
  const segments = source.segments ?? [];
  const isMultiProject = (source.projects?.length ?? 0) > 1;
  if (!segments.length && !isMultiProject) return null;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">Project sections</div>
      {segments.length ? (
        <div className="mt-2 space-y-2">
          {segments.map((segment) => (
            <div key={segment.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {segment.segment_scope === "general"
                    ? "General / Business"
                    : segment.project?.name || "Project"}
                </span>
                {!segment.has_content && (
                  <span className="text-xs text-muted-foreground">Not discussed</span>
                )}
                {(segment.topics ?? []).slice(0, 4).map((topic) => (
                  <span key={topic} className="border border-border px-1.5 py-0.5 text-xs">
                    {topic}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{segment.summary}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Project-specific sections have not been built yet.
        </p>
      )}
    </div>
  );
}

function SourceAssignmentEditor({
  source,
  projects,
  onSaved,
  onCancel,
}: {
  source: MarvinSource;
  projects: MarvinProjectOption[];
  onSaved: () => Promise<void>;
  onCancel?: () => void;
}) {
  const likely = candidateProjectIds(source);
  const generalOnly =
    source.knowledge_scope === "general" || source.metadata?.general_business === true;
  const linkedIds = source.projects?.map((project) => project.id) ?? [];
  const [selected, setSelected] = useState<string[]>(linkedIds.length ? linkedIds : likely);
  const [includeGeneral, setIncludeGeneral] = useState(
    generalOnly ||
      source.metadata?.include_general === true ||
      source.metadata?.general_segment_available === true,
  );
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await marvinRequest({
        action: "link_source",
        id: source.id,
        project_ids: selected,
        general_business: includeGeneral && !selected.length,
        include_general: includeGeneral && selected.length > 0,
      });
      await onSaved();
      toast.success("Source assignment saved.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <ProjectChecklist
        projects={projects}
        selected={selected}
        onChange={setSelected}
        likely={likely}
      />
      <label className="flex min-h-11 cursor-pointer items-center gap-2 border border-border px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={includeGeneral}
          onChange={(event) => setIncludeGeneral(event.target.checked)}
        />
        <BriefcaseBusiness className="h-4 w-4" />
        <span>General / Business</span>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || (!selected.length && !includeGeneral)}
          className="border border-ink bg-ink px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          Save assignment
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="border border-border px-4 py-2 text-sm"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function SourceRow({
  source,
  projects,
  onChanged,
  onRemove,
}: {
  source: MarvinSource;
  projects: MarvinProjectOption[];
  onChanged: () => Promise<void>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const candidates = candidateProjectIds(source)
    .map((id) => projects.find((project) => project.id === id)?.name)
    .filter(Boolean);
  const isGeneral =
    source.knowledge_scope === "general" || source.metadata?.general_business === true;
  const includesGeneral =
    isGeneral ||
    source.metadata?.include_general === true ||
    source.metadata?.general_segment_available === true;
  const isMultiProject = (source.projects?.length ?? 0) > 1;
  const usesProjectSections =
    isMultiProject || (Boolean(source.projects?.length) && includesGeneral);
  const segmentationStatus = String(source.metadata?.segmentation_status || "");
  const rebuildSegments = async () => {
    setRebuilding(true);
    try {
      await marvinRequest({ action: "rebuild_source_segments", id: source.id });
      await onChanged();
      toast.success("Project-specific meeting sections rebuilt.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRebuilding(false);
    }
  };
  return (
    <div className="py-5">
      <div className="grid gap-3 md:grid-cols-[28px_minmax(0,1fr)_auto]">
        <div className="pt-0.5">
          {source.source_type === "voice_memo" ? (
            <FileAudio className="h-4 w-4" />
          ) : source.source_type === "email" ? (
            <Mail className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">{source.title}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{source.occurred_at ? formatDate(source.occurred_at) : "No date"}</span>
            {isGeneral ? (
              <span className="inline-flex items-center gap-1">
                <BriefcaseBusiness className="h-3.5 w-3.5" /> General / Business
              </span>
            ) : source.projects?.length ? (
              <span>{source.projects.map((project) => project.name).join(", ")}</span>
            ) : (
              <span>Needs project review</span>
            )}
            {!source.projects?.length && !isGeneral && candidates.length > 0 && (
              <span>Potential: {candidates.join(", ")}</span>
            )}
            {source.projects?.length && includesGeneral && <span>General / Business</span>}
            {source.metadata?.auto_categorized_by_ai === true && <span>AI categorized</span>}
          </div>
          {source.processing_status === "failed" && (
            <div className="mt-2 text-xs text-red-700">{source.processing_error}</div>
          )}
          <SourceSummary source={source} />
          <SourceSegments source={source} />
          {usesProjectSections && (
            <button
              type="button"
              onClick={rebuildSegments}
              disabled={rebuilding || segmentationStatus === "processing"}
              className="mt-3 inline-flex items-center gap-2 border border-border px-3 py-2 text-xs disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${rebuilding || segmentationStatus === "processing" ? "animate-spin" : ""}`}
              />
              {rebuilding || segmentationStatus === "processing"
                ? "Building project sections"
                : "Rebuild project sections"}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {source.source_url && (
            <a
              href={source.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center border border-border"
              title="Open source"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="inline-flex h-8 w-8 items-center justify-center border border-border"
            title="Edit projects or scope"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-8 w-8 items-center justify-center border border-border"
            title="Delete source"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {editing && (
        <SourceAssignmentEditor
          source={source}
          projects={projects}
          onSaved={async () => {
            await onChanged();
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function ReviewView({
  sources,
  projects,
  onChanged,
}: {
  sources: MarvinSource[];
  projects: MarvinProjectOption[];
  onChanged: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "email" | "meeting" | "voice">("all");
  const sourceCounts = {
    all: sources.length,
    email: sources.filter((source) => ["email", "email_attachment"].includes(source.source_type))
      .length,
    meeting: sources.filter((source) => ["fathom", "transcript"].includes(source.source_type))
      .length,
    voice: sources.filter((source) => source.source_type === "voice_memo").length,
  };
  const filteredSources = sources.filter((source) => {
    if (sourceFilter === "all") return true;
    if (sourceFilter === "email") return ["email", "email_attachment"].includes(source.source_type);
    if (sourceFilter === "meeting") return ["fathom", "transcript"].includes(source.source_type);
    return source.source_type === "voice_memo";
  });
  const refreshMatches = async () => {
    setRefreshing(true);
    try {
      const result = await marvinRequest({ action: "refresh_source_matches" });
      await onChanged();
      toast.success(
        result.autoCategorized
          ? `AI categorized ${result.autoCategorized} meeting${result.autoCategorized === 1 ? "" : "s"}. ${result.needsReview || 0} source${result.needsReview === 1 ? "" : "s"} still need review.`
          : result.updated
            ? `AI checked ${result.updated} source${result.updated === 1 ? "" : "s"}; uncertain items remain for review.`
            : "No sources needed matching.",
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="eyebrow mb-1">Project Matching</div>
          <h3 className="font-display text-3xl">Review Uncertain Sources</h3>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Marvin automatically categorizes confident meetings and separates multi-project
            discussions. Only uncertain sources stay here for confirmation.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshMatches}
          disabled={refreshing || !sources.length}
          className="inline-flex items-center justify-center gap-2 border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          <Bot className={`h-4 w-4 ${refreshing ? "animate-pulse" : ""}`} />
          Auto-categorize with AI
        </button>
      </div>
      <div className="mt-6 flex max-w-full overflow-x-auto border border-border">
        {(
          [
            ["all", "All"],
            ["email", "Emails"],
            ["meeting", "Meeting Transcripts"],
            ["voice", "Voice Memos"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSourceFilter(value)}
            className={`min-h-10 shrink-0 border-r border-border px-4 text-sm last:border-r-0 ${
              sourceFilter === value ? "bg-ink text-white" : "bg-white text-ink"
            }`}
            aria-pressed={sourceFilter === value}
          >
            {label} ({sourceCounts[value]})
          </button>
        ))}
      </div>
      <div className="mt-6 divide-y divide-border border-y border-border">
        {filteredSources.map((source) => (
          <ReviewRow key={source.id} source={source} projects={projects} onChanged={onChanged} />
        ))}
        {!filteredSources.length && (
          <EmptyLine
            text={
              sourceFilter === "all"
                ? "No email, meeting, or voice memo sources need review."
                : `No ${sourceFilter === "email" ? "emails" : sourceFilter === "meeting" ? "meeting transcripts" : "voice memos"} need review.`
            }
          />
        )}
      </div>
    </div>
  );
}

function ReviewRow({
  source,
  projects,
  onChanged,
}: {
  source: MarvinSource;
  projects: MarvinProjectOption[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [content, setContent] = useState("");
  const candidates = candidateProjectIds(source)
    .map((id) => projects.find((project) => project.id === id)?.name)
    .filter(Boolean);
  const dismiss = async () => {
    setBusy(true);
    try {
      await marvinRequest({ action: "dismiss_source", id: source.id });
      await onChanged();
      toast.success("Unrelated source removed.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const toggleContent = async () => {
    if (reading) {
      setReading(false);
      return;
    }
    setReading(true);
    if (content) return;
    setLoadingContent(true);
    try {
      const result = await marvinRequest({ action: "source_detail", id: source.id });
      setContent(String(result.source?.content || ""));
    } catch (error) {
      setReading(false);
      toast.error(errorMessage(error));
    } finally {
      setLoadingContent(false);
    }
  };
  const summary = String(source.summary || source.content_preview || "").trim();
  const preview = summary.length > 420 ? `${summary.slice(0, 420).trimEnd()}...` : summary;
  return (
    <div className="py-5" data-testid={`marvin-review-source-${source.id}`}>
      <div>
        <div className="text-sm font-medium">{source.title}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{source.occurred_at ? formatDate(source.occurred_at) : "No date"}</span>
          <span>
            {source.match_reason}
            {source.author_name ? ` · ${source.author_name}` : ""}
          </span>
          {candidates.length > 0 && <span>Potential: {candidates.join(", ")}</span>}
        </div>
        {preview && (
          <div className="mt-3 border-l-2 border-border pl-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Summary</div>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">
              {preview}
            </p>
            <button
              type="button"
              onClick={toggleContent}
              disabled={loadingContent}
              className="mt-2 inline-flex items-center gap-1 text-xs text-ink underline disabled:opacity-50"
            >
              {reading ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {loadingContent ? "Loading email" : reading ? "Show less" : "Read more"}
            </button>
            {reading && !loadingContent && (
              <div className="mt-3 max-h-96 overflow-y-auto border border-border bg-secondary/30 p-4">
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  {source.source_type === "email" ? "Full email" : "Full source"}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {content || "No additional email content is available."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      {editing && (
        <SourceAssignmentEditor
          source={source}
          projects={projects}
          onSaved={async () => {
            await onChanged();
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 border border-ink bg-ink px-3 py-2 text-sm text-white"
          >
            <Link2 className="h-4 w-4" /> Assign source
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="inline-flex items-center gap-2 border border-border px-3 py-2 text-sm"
        >
          <Trash2 className="h-4 w-4" /> Mark unrelated
        </button>
      </div>
    </div>
  );
}

function SettingsView({
  data,
  currentEmail,
  onChanged,
}: {
  data: MarvinBootstrap;
  currentEmail: string;
  onChanged: () => Promise<void>;
}) {
  const [fathomKey, setFathomKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState({
    project_id: "",
    contact_type: "client",
    name: "",
    email: "",
    alias: "",
  });
  const gmail = data.integrations.find(
    (integration) =>
      integration.provider === "gmail" &&
      integration.account_email?.toLowerCase() === currentEmail.toLowerCase(),
  );
  const fathom = data.integrations.find((integration) => integration.provider === "fathom");

  const connectGmail = async () => {
    setBusy(true);
    try {
      const body = await marvinRequest({ action: "gmail_connect" });
      window.location.href = body.url;
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  };
  const connectFathom = async () => {
    setBusy(true);
    try {
      await marvinRequest({ action: "connect_fathom", api_key: fathomKey });
      setFathomKey("");
      await onChanged();
      toast.success("Katie's Fathom account is connected.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    setBusy(true);
    try {
      await marvinRequest({ action: "sync_now" });
      await onChanged();
      toast.success("Marvin sync completed.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async (id: string, label: string) => {
    setBusy(true);
    try {
      await marvinRequest({ action: "disconnect", id });
      await onChanged();
      toast.success(`${label} disconnected. Confirmed sources were preserved.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const addContact = async () => {
    setBusy(true);
    try {
      await marvinRequest({ action: "add_contact", ...contact });
      setContact({ project_id: "", contact_type: "client", name: "", email: "", alias: "" });
      toast.success("Project match added.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-9">
      <div>
        <div className="eyebrow mb-1">Connections</div>
        <h3 className="font-display text-3xl">Marvin Settings</h3>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <h4 className="font-medium">Your MERAV Gmail</h4>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Read-only. Incoming and sent messages are matched to projects; Marvin cannot send or
            create drafts.
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs">
              {gmail
                ? `${gmail.status} · ${gmail.last_sync_at ? `last synced ${formatDate(gmail.last_sync_at)}` : "not synced"}`
                : "Not connected"}
            </span>
            <div className="flex gap-2">
              {gmail && (
                <button
                  type="button"
                  onClick={() => disconnect(gmail.id, "Gmail")}
                  disabled={busy}
                  className="border border-border px-3 py-2 text-sm"
                >
                  Disconnect
                </button>
              )}
              <button
                type="button"
                onClick={connectGmail}
                disabled={busy}
                className="border border-ink px-3 py-2 text-sm"
              >
                {gmail ? "Reconnect" : "Connect Gmail"}
              </button>
            </div>
          </div>
        </section>
        <section className="border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <FileAudio className="h-4 w-4" />
            <h4 className="font-medium">Katie's Fathom</h4>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Adds new recordings automatically with transcript, summary, and action items.
          </p>
          {currentEmail.toLowerCase() === "katie@meravinteriors.com" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                type="password"
                value={fathomKey}
                onChange={(event) => setFathomKey(event.target.value)}
                placeholder={fathom ? "Enter a new API key to reconnect" : "Fathom API key"}
                className="h-10 min-w-0 flex-1 border border-border px-3 text-sm"
              />
              <button
                type="button"
                onClick={connectFathom}
                disabled={busy || !fathomKey.trim()}
                className="border border-ink px-3 py-2 text-sm"
              >
                {fathom ? "Reconnect" : "Connect"}
              </button>
              {fathom && (
                <button
                  type="button"
                  onClick={() => disconnect(fathom.id, "Fathom")}
                  disabled={busy}
                  className="border border-border px-3 py-2 text-sm"
                >
                  Disconnect
                </button>
              )}
            </div>
          ) : (
            <div className="mt-4 text-xs text-muted-foreground">
              Katie connects this from her account.
            </div>
          )}
        </section>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-y border-border py-4">
        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="inline-flex items-center gap-2 border border-ink bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{" "}
          Sync Now
        </button>
        <span className="text-xs text-muted-foreground">
          Sync is resumable. Uncertain matches go to Review.
        </span>
      </div>
      <section>
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <h4 className="font-medium">Project Contacts and Aliases</h4>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A unique contact email is the strongest automatic project match after a confirmed Gmail
          thread.
        </p>
        <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-6">
          <select
            value={contact.project_id}
            onChange={(event) => setContact({ ...contact, project_id: event.target.value })}
            className="h-10 border border-border bg-white px-2 text-sm lg:col-span-2"
          >
            <option value="">Choose project</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            value={contact.contact_type}
            onChange={(event) => setContact({ ...contact, contact_type: event.target.value })}
            className="h-10 border border-border bg-white px-2 text-sm"
          >
            <option value="client">Client</option>
            <option value="gc">GC</option>
            <option value="vendor">Vendor</option>
            <option value="architect">Architect</option>
            <option value="other">Other</option>
          </select>
          <input
            value={contact.name}
            onChange={(event) => setContact({ ...contact, name: event.target.value })}
            placeholder="Name"
            className="h-10 border border-border px-2 text-sm"
          />
          <input
            value={contact.email}
            onChange={(event) => setContact({ ...contact, email: event.target.value })}
            placeholder="Email"
            className="h-10 border border-border px-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              value={contact.alias}
              onChange={(event) => setContact({ ...contact, alias: event.target.value })}
              placeholder="Alias"
              className="h-10 min-w-0 flex-1 border border-border px-2 text-sm"
            />
            <button
              type="button"
              onClick={addContact}
              disabled={
                busy || !contact.project_id || (!contact.email.trim() && !contact.alias.trim())
              }
              className="inline-flex h-10 w-10 items-center justify-center border border-ink bg-ink text-white disabled:opacity-40"
              title="Add project match"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="border-y border-border py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function PriorityLabel({ value }: { value: string }) {
  const urgent = value.toLowerCase() === "urgent";
  return (
    <span
      className={`inline-flex px-2 py-1 text-[10px] font-medium uppercase tracking-[0.1em] ${urgent ? "bg-red-100 text-red-800" : "bg-secondary text-ink"}`}
    >
      {value}
    </span>
  );
}

async function authToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

async function loadMarvin() {
  return (await marvinGet()) as MarvinBootstrap;
}

async function marvinGet(query = "") {
  const token = await authToken();
  const response = await fetch(`/api/marvin${query ? `?${query}` : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Marvin could not load.");
  return body;
}

async function marvinRequest(body: Record<string, unknown>) {
  const token = await authToken();
  const response = await fetch("/api/marvin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || "Marvin could not complete that action.");
  return result;
}

async function marvinUpload(form: FormData) {
  const token = await authToken();
  const response = await fetch("/api/marvin-upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || "Marvin could not upload this file.");
  return result;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Marvin could not complete that action.";
}
