import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  FileAudio,
  FileImage,
  ImagePlus,
  Loader2,
  Mic,
  Square,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

type Capture = {
  id: string;
  title: string;
  source_type: "voice_memo" | "note";
  summary?: string | null;
  occurred_at?: string | null;
  mime_type?: string | null;
  processing_status: string;
  metadata?: {
    action_items?: Array<{ text?: string }>;
    changes_requested?: string[];
    visual_notes?: string[];
  } | null;
};

async function authToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

async function projectCaptureRequest(projectId: string) {
  const token = await authToken();
  const response = await fetch(
    `/api/project-captures?project_id=${encodeURIComponent(projectId)}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Project captures could not load.");
  return body as { captures: Capture[] };
}

async function uploadCapture(projectId: string, title: string, file: File) {
  const token = await authToken();
  const form = new FormData();
  form.set("project_id", projectId);
  form.set("title", title);
  form.set("file", file);
  const response = await fetch("/api/project-captures", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Project capture could not be saved.");
  return body.capture as Capture;
}

async function openOriginal(sourceId: string) {
  const target = window.open("", "_blank");
  try {
    const token = await authToken();
    const response = await fetch(
      `/api/project-captures?source_id=${encodeURIComponent(sourceId)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || "Original capture could not open.");
    }
    const url = URL.createObjectURL(await response.blob());
    if (target) target.location.href = url;
    else window.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    target?.close();
    throw error;
  }
}

export function ProjectCaptureDialog({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"voice" | "notes">("voice");
  const [title, setTitle] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const audioInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const query = useQuery({
    queryKey: ["projectCaptures", projectId],
    queryFn: () => projectCaptureRequest(projectId),
    enabled: open,
  });
  const photoPreviews = useMemo(
    () => photoFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [photoFiles],
  );

  useEffect(
    () => () => {
      photoPreviews.forEach(({ url }) => URL.revokeObjectURL(url));
    },
    [photoPreviews],
  );

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const changeOpen = (next: boolean) => {
    if (!next && recording) recorderRef.current?.stop();
    if (!next) stopTracks();
    setOpen(next);
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        setAudioFile(
          new File([blob], `meeting-voice-memo-${new Date().toISOString().slice(0, 19)}.webm`, {
            type,
          }),
        );
        stopTracks();
      };
      recorder.start();
      setRecording(true);
    } catch {
      toast.error("Allow microphone access, or choose an audio file instead.");
    }
  };

  const save = async () => {
    const files = mode === "voice" ? (audioFile ? [audioFile] : []) : photoFiles;
    if (!files.length) {
      toast.error(
        mode === "voice"
          ? "Record or choose a voice memo first."
          : "Take or choose a note photo first.",
      );
      return;
    }
    setBusy(true);
    try {
      for (let index = 0; index < files.length; index += 1) {
        setProgress(
          mode === "voice"
            ? "Transcribing and organizing the voice memo…"
            : `Reading note photo ${index + 1} of ${files.length}…`,
        );
        const baseTitle = title.trim() || `${projectName} meeting follow-up`;
        await uploadCapture(
          projectId,
          files.length > 1 ? `${baseTitle} — page ${index + 1}` : baseTitle,
          files[index],
        );
      }
      setAudioFile(null);
      setPhotoFiles([]);
      setTitle("");
      await qc.invalidateQueries({ queryKey: ["projectCaptures", projectId] });
      await qc.invalidateQueries({ queryKey: ["marvin"] });
      toast.success(
        mode === "voice"
          ? "Voice memo saved as project knowledge."
          : `${files.length} note photo${files.length === 1 ? "" : "s"} saved and read.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Project capture could not be saved.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const captures = query.data?.captures ?? [];

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex flex-1 items-center justify-center gap-2 border border-ink px-4 py-2.5 text-sm text-ink transition-colors hover:bg-ink hover:text-primary-foreground sm:flex-none"
        >
          <Mic className="h-4 w-4" /> Project Capture
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="eyebrow mb-2">Private Project Knowledge</div>
          <DialogTitle className="font-display text-4xl">Capture the meeting</DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-6 text-muted-foreground">
          Record a recap or photograph handwritten notes. Marvin keeps the original, reads it, and
          adds the facts, changes, sketches, and follow-ups to {projectName}. Nothing is sent.
        </p>

        <div className="mt-5 inline-flex border border-border" aria-label="Capture type">
          <button
            type="button"
            onClick={() => setMode("voice")}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm ${mode === "voice" ? "bg-ink text-white" : "bg-white"}`}
          >
            <Mic className="h-4 w-4" /> Voice memo
          </button>
          <button
            type="button"
            onClick={() => setMode("notes")}
            className={`inline-flex items-center gap-2 border-l border-border px-4 py-2 text-sm ${mode === "notes" ? "bg-ink text-white" : "bg-white"}`}
          >
            <ImagePlus className="h-4 w-4" /> Note photos
          </button>
        </div>

        <div className="mt-5 border-y border-border py-5">
          <Label htmlFor="capture-title">Meeting title</Label>
          <Input
            id="capture-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`${projectName} meeting follow-up`}
            className="mt-2"
          />

          {mode === "voice" ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={toggleRecording}
                disabled={busy}
                className={`flex min-h-24 items-center justify-center gap-3 border px-5 text-sm ${recording ? "border-red-600 bg-red-50 text-red-700" : "border-border bg-bone/20"}`}
              >
                {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                {recording ? "Stop recording" : "Start recording"}
              </button>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg"
                className="hidden"
                onChange={(event) => {
                  setAudioFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => audioInputRef.current?.click()}
                disabled={busy || recording}
                className="flex min-h-24 items-center justify-center gap-3 border border-border px-5 text-sm"
              >
                <Upload className="h-5 w-5" /> Choose existing recording
              </button>
              {audioFile && (
                <div className="flex items-center gap-2 border border-border px-4 py-3 text-sm sm:col-span-2">
                  <FileAudio className="h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate">{audioFile.name}</span>
                  <CheckCircle2 className="h-4 w-4 text-green-700" />
                </div>
              )}
            </div>
          ) : (
            <div className="mt-5">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).slice(0, 6);
                  setPhotoFiles((current) => [...current, ...files].slice(0, 6));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={busy}
                className="flex min-h-28 w-full items-center justify-center gap-3 border border-dashed border-border bg-bone/20 px-5 text-sm"
              >
                <ImagePlus className="h-5 w-5" /> Take or choose note photos
              </button>
              {photoPreviews.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {photoPreviews.map(({ file, url }) => (
                    <div
                      key={`${file.name}-${file.lastModified}`}
                      className="border border-border p-2"
                    >
                      <img src={url} alt={file.name} className="h-28 w-full object-cover" />
                      <div className="mt-2 truncate text-xs text-muted-foreground">{file.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={save}
            disabled={busy || recording}
            className="mt-5 inline-flex min-h-11 items-center gap-2 bg-ink px-5 py-2.5 text-sm text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {busy ? progress || "Saving…" : "Save to project knowledge"}
          </button>
          <p className="mt-3 text-xs text-muted-foreground">
            Originals stay private to Marvin. Note photos remain available as evidence, including
            drawings and marked-up diagrams.
          </p>
        </div>

        <div className="mt-6">
          <div className="eyebrow mb-3">Recent Captures</div>
          {query.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading project captures…
            </div>
          ) : captures.length ? (
            <div className="divide-y divide-border border-y border-border">
              {captures.map((capture) => {
                const actionCount = capture.metadata?.action_items?.length ?? 0;
                const changeCount = capture.metadata?.changes_requested?.length ?? 0;
                return (
                  <div key={capture.id} className="flex gap-3 py-4">
                    {capture.source_type === "voice_memo" ? (
                      <FileAudio className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <FileImage className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{capture.title}</div>
                      {capture.summary && (
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {capture.summary}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {capture.occurred_at && (
                          <span>{new Date(capture.occurred_at).toLocaleString()}</span>
                        )}
                        {changeCount > 0 && (
                          <span>
                            {changeCount} requested change{changeCount === 1 ? "" : "s"}
                          </span>
                        )}
                        {actionCount > 0 && (
                          <span>
                            {actionCount} action item{actionCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        openOriginal(capture.id).catch((error) => toast.error(error.message))
                      }
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-border"
                      title="Open original"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-dashed border-border p-6 text-sm text-muted-foreground">
              No voice memos or note photos have been added to this project yet.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
