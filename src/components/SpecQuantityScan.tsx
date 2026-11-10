import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createStudioSessionRequest } from "@/lib/studioSessionRequest";
import { BatchApprovalError, batchApprovalResponse, batchResultsComplete } from "@/lib/batchApprovalResponse";
import { quantityReviewEligible, type DrawingMatchReport } from "@/lib/specDrawingMatches";
import { specQuantityUnit } from "@/lib/specQuantity";
import { completionMaterialsLink } from "@/lib/specCompletionPresentation";
import { missingFixtureAlternatives } from "@/lib/specMissingAlternatives";
import type { MaterialItem } from "@/lib/db";
import type { CompletionRoom } from "@/lib/specCompletion";

export function SpecQuantityScan({ projectId, items, rooms, runSignal = 0, fullCheckRunId = "" }: { projectId: string; items: MaterialItem[]; rooms: CompletionRoom[]; runSignal?: number; fullCheckRunId?: string }) {
  const qc = useQueryClient();
  const [report, setReport] = useState<DrawingMatchReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<Array<{ itemId: string; label: string; status: "applied" | "failed" | "skipped" | "check"; message?: string }>>([]);
  const [savedNeedsRefresh, setSavedNeedsRefresh] = useState(false);
  const lock = useRef(false);
  const handledSignal = useRef(0);
  const load = async (key?: string, attemptNumber = attempt) => {
    const request = await createStudioSessionRequest();
    const response = await request(`/api/spec-drawing-matches?projectId=${encodeURIComponent(projectId)}&purpose=quantities&attempt=${attemptNumber}`, key ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, expectedKey: key, purpose: "quantities", attempt: attemptNumber, full_check_run_id: fullCheckRunId }),
    } : {});
    const body = await response.json();
    if (!response.ok) throw Error(body.error || "Could not check the construction drawings.");
    return body as DrawingMatchReport;
  };
  useEffect(() => {
    let active = true;
    void load().then(value => { if (active) setReport(value); }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [projectId]);
  useEffect(() => {
    if (!report || !["queued", "checking"].includes(report.status)) return;
    const timer = setTimeout(() => { void load().then(setReport).catch(reason => setError(reason.message)); }, 5000);
    return () => clearTimeout(timer);
  }, [projectId, report, attempt]);
  const start = async (retry = false) => {
    if (lock.current || !report?.key || !report.canScan || !fullCheckRunId) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (retry) {
        const next = attempt + 1;
        if (next > 5) throw Error("The retry limit has been reached. Review the saved findings.");
        const fresh = await load(undefined, next);
        if (!fresh.key) throw Error("No current construction document is available.");
        setAttempt(next); setReport(await load(fresh.key, next));
      } else { setReport(await load(report.freshKey || report.key)); setSavedNeedsRefresh(false); }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the drawing check."); }
    finally { lock.current = false; setBusy(false); }
  };
  useEffect(() => {
    if (!runSignal || handledSignal.current === runSignal || !report) return;
    handledSignal.current = runSignal;
    if (report.status === "unread" && report.key) void start();
  }, [runSignal, report]);
  const working = !!report && ["queued", "checking"].includes(report.status);
  const eligible = (report?.quantityFindings || []).filter(row => report?.status === "complete" && !report.needsFreshScan && !savedNeedsRefresh && row.status === "suggested" &&
    row.quantity != null && items.some(item => item.id === row.itemId && !item.not_needed && quantityReviewEligible(item) && specQuantityUnit(item) === "count"));
  const selectedEligible = eligible.filter(row => selected.includes(row.itemId));
  const applySelected = async () => {
    if (applying || !report?.key || !selectedEligible.length || report.status !== "complete") return;
    setApplying(true); setError(""); setApplyResults([]);
    try {
      const request = await createStudioSessionRequest();
      const body = await batchApprovalResponse(() => request("/api/spec-drawing-matches", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, purpose: "quantities", action: "apply", expectedKey: report.key,
          attempt, itemIds: selectedEligible.map(row => row.itemId) }) }),
        (value): value is { results: Array<{ itemId: string; status: "applied" | "failed" | "skipped" | "check"; message?: string }>; appliedCount: number } =>
          batchResultsComplete(value, selectedEligible.map(row => row.itemId), "itemId", ["applied", "failed", "skipped", "check"]) &&
          Number.isInteger((value as { appliedCount?: number }).appliedCount) && (value as { appliedCount: number }).appliedCount >= 0 &&
          (value as { appliedCount: number }).appliedCount === (value as { results: Array<{ status: string }> }).results.filter(row => row.status === "applied").length);
      setApplyResults(body.results.map(row => ({ ...row, label: selectedEligible.find(item => item.itemId === row.itemId)?.label || "Selection" })));
      setSelected([]);
      if (body.appliedCount > 0 || body.results.some((row: { status: string }) => row.status === "check")) setSavedNeedsRefresh(true);
      void Promise.all([["materialItems", projectId], ["procurement"], ["spec-completion-review", projectId]].map(queryKey => qc.invalidateQueries({ queryKey })));
      if (body.appliedCount > 0 || body.results.some((row: { status: string }) => row.status === "check")) {
        try { const current = await load(undefined, attempt); setReport(current.needsFreshScan ? current : { ...report, needsFreshScan: true, freshKey: current.key }); setSavedNeedsRefresh(false); }
        catch { setError("The results are shown above, but the drawing review could not refresh. Check the saved quantities and refresh this page before applying more."); }
      }
    } catch (reason) {
      if (reason instanceof BatchApprovalError && reason.unknownOutcome) {
        setSavedNeedsRefresh(true); setSelected([]);
        void Promise.all([["materialItems", projectId], ["procurement"], ["spec-completion-review", projectId]].map(queryKey => qc.invalidateQueries({ queryKey })));
      }
      setError(reason instanceof Error ? reason.message : "Could not apply these quantities.");
    }
    finally { setApplying(false); }
  };
  return <details open={working || !!report?.quantityFindings?.length || !!report?.missingFindings?.length || undefined} className="shrink-0 border p-3 text-xs">
    <summary className="cursor-pointer font-medium">Check quantities across construction drawings</summary>
    <p className="mt-2">Reads the current drawing set in page groups, compares supported room counts with the Spec Book, and looks for possible missing fixtures. It sends the PDF and selections to OpenAI; the estimated scan is capped at $5 before it starts. Counts, conflicts and missing-item suggestions must be reviewed before editing.</p>
    <button type="button" onClick={() => void start(report?.status === "partial" || report?.status === "failed")} disabled={busy || working || !report?.key || !report.canScan || !fullCheckRunId || (report.status === "complete" && !report.needsFreshScan) || savedNeedsRefresh}
      className="mt-2 border px-3 py-2 disabled:opacity-50">{working ? "Checking drawings…" : report?.needsFreshScan ? "Check updated drawings and selections" : report?.status === "complete" ? "Drawing check complete" : report?.status === "partial" || report?.status === "failed" ? "Retry drawing check" : "Check drawing quantities"}</button>
    {report && !report.canScan && <p className="mt-1 text-muted-foreground">Only Ken can start a drawing check. Saved findings remain available for review.</p>}
    {report && <p className="mt-2" role="status">{report.status === "no_document" ? "No construction document is attached." :
      `${report.reviewedPages.length} of ${report.totalPages || "?"} pages checked${report.ceilingUsd != null ? ` · estimated maximum $${report.ceilingUsd.toFixed(2)}` : ""}. ${report.status === "partial" || report.status === "failed" ? "Scan incomplete; unchecked pages remain unverified." : ""}`}</p>}
    {(error || report?.error) && <p role="alert" className="mt-2 text-red-800">{error || report?.error}</p>}
    {(report?.needsFreshScan || savedNeedsRefresh) && <p className="mt-2 text-amber-800">These findings are from an earlier scan. Review the evidence here; run a fresh drawing check before approving more quantities.</p>}
    {!!eligible.length && <div className="mt-3 border p-3">
      <p className="font-medium">Approve drawing quantities</p>
      <p className="mt-1 text-muted-foreground">Review the current quantity, suggested count and drawing source below. Choose up to 100 complete, nonconflicting counts. Conflicts and minimum counts still need individual review.</p>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="border px-3 py-2 disabled:opacity-50" disabled={applying} onClick={() => { setSelected(eligible.slice(0, 100).map(row => row.itemId)); setApplyResults([]); }}>Select suggested quantities</button>
        <button type="button" className="border px-3 py-2 disabled:opacity-50" disabled={applying || !selected.length} onClick={() => setSelected([])}>Clear selection</button>
        <button type="button" className="bg-ink px-3 py-2 text-white disabled:opacity-50" disabled={applying || !selectedEligible.length} onClick={() => void applySelected()}>{applying ? "Applying quantities…" : `Approve & apply selected (${selectedEligible.length})`}</button></div>
    </div>}
    {!!applyResults.length && <div role="status" className="mt-2"><p>Applied {applyResults.filter(row => row.status === "applied").length}; failed {applyResults.filter(row => row.status === "failed").length}; skipped {applyResults.filter(row => row.status === "skipped").length}; check {applyResults.filter(row => row.status === "check").length}. Changes marked check may have saved; verify before retrying.</p><ul>{applyResults.map(result => <li key={result.itemId}>{result.label}: {result.status}{result.message ? ` — ${result.message}` : ""}</li>)}</ul></div>}
    {!!report?.quantityFindings?.length && <ul className="mt-3 max-h-56 overflow-auto space-y-3">{report.quantityFindings.map(row => <li key={row.itemId} className="border-t pt-2">
      {eligible.some(option => option.itemId === row.itemId) && <label className="mr-2"><input type="checkbox" checked={selected.includes(row.itemId)} disabled={applying || (!selected.includes(row.itemId) && selectedEligible.length >= 100)} aria-label={`Select quantity for ${row.room} ${row.label}`}
        onChange={event => { setApplyResults([]); setSelected(current => event.target.checked ? [...current, row.itemId] : current.filter(id => id !== row.itemId)); }} /> Select</label>}
      <a className="font-medium underline" href={completionMaterialsLink(projectId, "", row.itemId)} target="_blank" rel="noopener noreferrer">{row.room} · {row.label}</a>
      <p>Spec Book: {row.current} · {row.status === "conflict" ? "Drawing counts conflict — confirm" : row.status === "minimum" ? `At least ${row.quantity} shown; confirm room total` : `${report.status === "complete" ? "Drawing suggests" : "Provisional; remaining pages are unverified"}: ${row.quantity}`}</p>
      {row.sources.map((source, index) => <p key={`${source.page}-${index}`}>
        {report.documentUrl ? <a className="underline" href={`${report.documentUrl}#page=${source.page}`} target="_blank" rel="noopener noreferrer">Page {source.page} · {source.sheet}</a> : `Page ${source.page} · ${source.sheet}`} — {source.evidence} ({source.source === "layout_minimum" ? "at least " : ""}{source.quantity})
      </p>)}
    </li>)}</ul>}
    {!!report?.missingFindings?.length && <div className="mt-3"><p className="font-medium">Possible missing fixtures</p><ul className="mt-2 max-h-80 overflow-auto space-y-2">{report.missingFindings.map(row => <li key={`${row.roomId}-${row.label}`} className="border-t pt-2">
      <a className="underline" href={completionMaterialsLink(projectId, row.roomId)} target="_blank" rel="noopener noreferrer">{row.room} · {row.label}</a> — verify the selection.
      <p>{report.documentUrl ? <a className="underline" href={`${report.documentUrl}#page=${row.page}`} target="_blank" rel="noopener noreferrer">Page {row.page} · {row.sheet}</a> : `Page ${row.page} · ${row.sheet}`} — {row.evidence}</p>
      {missingFixtureAlternatives(row.label, row.roomId, items, rooms).map(option => <p key={option.itemId} className="mt-1 text-muted-foreground">Possible lead from {rooms.find(room => room.id === option.roomId)?.name || "another room"}: <a href={completionMaterialsLink(projectId, option.roomId, option.itemId)} target="_blank" rel="noopener noreferrer" className="underline">{option.name}</a>{option.color ? ` · ${option.color}` : ""} · <a className="underline" href={option.url} target="_blank" rel="noopener noreferrer">Product link</a> (confirm it belongs here)</p>)}
    </li>)}</ul></div>}
    {report?.status === "complete" && !report.quantityFindings?.length && !report.missingFindings?.length && <p className="mt-2">No supported differences found. Unclear or unmatched items are not confirmed.</p>}
    {!!report?.uncertainties?.length && <p className="mt-2">{report.uncertainties.length} drawing notes need review: {report.uncertainties.slice(0, 4).join("; ")}</p>}
  </details>;
}
