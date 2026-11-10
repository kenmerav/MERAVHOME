import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createStudioSessionRequest } from "@/lib/studioSessionRequest";
import { BatchApprovalError, batchApprovalResponse, batchResultsComplete } from "@/lib/batchApprovalResponse";
import { batchCompletionProposal } from "@/lib/specCompletionBatch";
import { completionMaterialsLink, completionProductLink } from "@/lib/specCompletionPresentation";
import type { MaterialItem } from "@/lib/db";
import type { SavedCompletionIssue } from "@/lib/savedSpecCompletion";
import type { CompletionRoom } from "@/lib/specCompletion";

type BatchResult = { issue_key: string; status: "saved" | "check" | "not_attempted"; message?: string };

export function SpecCompletionBatchReview({ projectId, items, rooms, issues, checkedAt, disabled }: {
  projectId: string; items: MaterialItem[]; rooms: CompletionRoom[]; issues: SavedCompletionIssue[];
  checkedAt?: string; disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<BatchResult[]>([]);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const proposals = issues.flatMap(issue => {
    const proposal = batchCompletionProposal(issue);
    const item = items.find(row => row.id === issue.finding.item_id && row.room_id === issue.finding.room_id);
    if (!proposal || !item || item.not_needed || issue.last_seen_at !== checkedAt ||
      (issue.item_preview?.product_id && issue.item_preview.product_id !== item.product_id)) return [];
    return [{ issue, item, proposal }];
  });
  const conflicts = (a: typeof proposals[number], b: typeof proposals[number]) => a.item.id === b.item.id ||
    (!!a.item.product_id && a.item.product_id === b.item.product_id);
  const chosen = proposals.filter(row => selected.includes(row.issue.key));
  const selectedKeys = new Set(chosen.map(row => row.issue.key));
  const selectable = proposals.filter(row => (selectedKeys.has(row.issue.key) || chosen.length < 100) && !chosen.some(current => current.issue.key !== row.issue.key && conflicts(row, current)));
  const selectAll = () => {
    const unique: typeof proposals = [];
    for (const row of proposals) if (unique.length < 100 && !unique.some(current => conflicts(row, current))) unique.push(row);
    setSelected(unique.map(row => row.issue.key)); setResults([]); setError("");
  };
  const submit = async () => {
    if (busy || disabled || needsRefresh || !chosen.length) return;
    setBusy(true); setError(""); setResults([]);
    try {
      const request = await createStudioSessionRequest();
      const data = await batchApprovalResponse(() => request("/api/spec-completion-review", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, action: "batch_detail", entries: chosen.map(({ item, issue }) => ({
          issue_key: issue.key, expected_updated_at: issue.status_updated_at, expected_material_updated_at: item.updated_at,
          expected_product_id: item.product_id, expected_product_updated_at: item.product?.updated_at ?? null,
        })) }) }), (value): value is { results: BatchResult[] } =>
          batchResultsComplete(value, chosen.map(({ issue }) => issue.key), "issue_key", ["saved", "check", "not_attempted"]));
      setResults(data.results); setSelected([]);
    } catch (reason) {
      if (reason instanceof BatchApprovalError && reason.unknownOutcome) { setNeedsRefresh(true); setSelected([]); }
      setError(reason instanceof Error ? reason.message : "Could not apply the selected changes.");
    }
    finally {
      setBusy(false);
      for (const queryKey of [["materialItems", projectId], ["procurement"], ["catalog"], ["products"], ["roomProducts"], ["spec-completion-review", projectId]])
        void qc.invalidateQueries({ queryKey });
    }
  };
  if (!proposals.length && !results.length && !error) return null;
  return <section className="shrink-0 border bg-bone/20 p-4 text-sm" aria-label="Approve suggested changes">
    <h3 className="font-medium">Suggested changes ready for review</h3>
    <p className="mt-1 text-xs text-muted-foreground">Review the current value, proposed change and source, then choose the changes to save to the Spec Book and Materials. A shared catalog product can affect other rooms. Select up to 100 changes, with one at a time for the same item or shared product. Conflicts, unclear choices and missing fixtures remain for individual review. Use the drawing quantities list to approve counts.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="border px-3 py-2 text-xs disabled:opacity-50" disabled={disabled || needsRefresh || busy || !proposals.length} onClick={selectAll}>Select available changes</button>
      <button type="button" className="border px-3 py-2 text-xs disabled:opacity-50" disabled={busy || !selected.length} onClick={() => setSelected([])}>Clear selection</button>
      <button type="button" className="bg-ink px-3 py-2 text-xs text-white disabled:opacity-50" disabled={disabled || needsRefresh || busy || !chosen.length} onClick={() => void submit()}>{busy ? "Applying changes…" : `Approve & apply selected (${chosen.length})`}</button>
    </div>
    {disabled && <p className="mt-2 text-xs text-amber-800">Refresh the saved check before approving changes.</p>}
    <div className="mt-3 max-h-72 overflow-auto border bg-white">
      <table className="w-full text-left text-xs"><thead><tr className="bg-bone/50"><th className="p-2">Select</th><th className="p-2">Room · item</th><th className="p-2">Current</th><th className="p-2">Proposed</th><th className="p-2">Evidence</th></tr></thead>
        <tbody>{proposals.map(({ issue, item, proposal }) => {
          const canSelect = selectable.some(row => row.issue.key === issue.key);
          const room = rooms.find(row => row.id === issue.finding.room_id)?.name || issue.room_name || "Room";
          const productLink = completionProductLink(item.product_url || item.product?.product_url);
          return <tr key={issue.key} className="border-t align-top">
            <td className="p-2"><input type="checkbox" aria-label={`Select ${room} ${issue.finding.item_label} ${proposal.field}`} checked={selectedKeys.has(issue.key)} disabled={disabled || needsRefresh || busy || !canSelect}
              onChange={event => { setResults([]); setSelected(current => event.target.checked ? [...current, issue.key] : current.filter(key => key !== issue.key)); }} /></td>
            <td className="p-2"><a className="underline" href={completionMaterialsLink(projectId, item.room_id, item.id)} target="_blank" rel="noopener noreferrer">{room} · {issue.finding.item_label}</a><div>{proposal.field}</div></td>
            <td className="p-2">{issue.finding.current || "Not set"}</td><td className="p-2 font-medium">{proposal.value}</td>
            <td className="p-2">{issue.finding.sheet ? `${issue.finding.sheet} · ` : ""}{issue.finding.page ? `Page ${issue.finding.page} · ` : ""}{issue.finding.evidence || "Selected product link"} {issue.finding.source === "plans" ? <a href={`/projects/${projectId}/construction-docs`} target="_blank" rel="noopener noreferrer" className="underline">View construction documents</a> : productLink && <a href={productLink} target="_blank" rel="noopener noreferrer" className="underline">View product</a>}{!canSelect && <p className="mt-1 text-amber-800">Another selected change uses this item or product, or the 100-change limit is reached.</p>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-800">{error}</p>}
    {!!results.length && <div className="mt-2 text-xs" role="status"><p>Saved {results.filter(row => row.status === "saved").length}; check {results.filter(row => row.status === "check").length}; not attempted {results.filter(row => row.status === "not_attempted").length}. A change marked check may have saved; refresh the review before retrying.</p>
      <ul className="mt-1 space-y-1">{results.map(result => {
        const issue = issues.find(row => row.key === result.issue_key);
        return <li key={result.issue_key}>{issue?.room_name || "Room"} · {issue?.finding.item_label || "Selection"}: {result.status.replace("_", " ")}{result.message ? ` — ${result.message}` : ""}</li>;
      })}</ul>
    </div>}
  </section>;
}
