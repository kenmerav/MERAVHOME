import { useEffect, useRef, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { z } from "zod";
import { ConstructionDrawingPicker } from "./ConstructionDrawingPicker";
import { studioHeaders } from "@/lib/measuredRequest";
import { supabase } from "@/integrations/supabase/client";
import {
  CODEX_BATCH_INSTRUCTIONS,
  codexReferenceExtension,
  codexBatchReportSchema,
  type CodexBatchRow,
  type CodexBatchItem,
} from "@/lib/codexRenderingBatch";
import type { DrawingCitation } from "@/lib/constructionDrawingViews";

export function CodexRenderingBatch({
  projectId,
  initialRoomId,
}: {
  projectId: string;
  initialRoomId?: string;
}) {
  const [rows, setRows] = useState<CodexBatchRow[]>([]),
    [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [roomId, setRoomId] = useState(initialRoomId || ""),
    [name, setName] = useState(""),
    [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = useRef(false),
    refreshVersion = useRef(0);
  const [preparedPackage, setPreparedPackage] = useState<{
    url: string;
    filename: string;
    count: number;
  } | null>(null);
  useEffect(
    () => () => {
      if (preparedPackage) URL.revokeObjectURL(preparedPackage.url);
    },
    [preparedPackage],
  );
  const endpoint = `/api/measured-rendering?projectId=${projectId}&codexBatch=1`;
  async function api(body?: unknown) {
    const response = await fetch(endpoint, {
      method: body ? "POST" : "GET",
      headers: await studioHeaders(),
      signal: AbortSignal.timeout(60000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not save this batch.");
    return data;
  }
  async function refresh() {
    const version = ++refreshVersion.current;
    const data = await api();
    if (version !== refreshVersion.current) return;
    setRows(data.rows);
    setRooms(data.rooms);
    setSelected((old) =>
      old.filter((id) => data.rows.some((r: CodexBatchRow) => r.id === id && !r.result)),
    );
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    return () => {
      refreshVersion.current++;
    };
  }, [projectId]);
  async function run(label: string, fn: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete batch operation.");
    } finally {
      active.current = false;
      setBusy("");
    }
  }
  async function upload(room: string, blob: Blob) {
    const response = await fetch(`/api/measured-rendering?projectId=${projectId}&roomId=${room}`, {
      method: "POST",
      headers: await studioHeaders(),
      body: JSON.stringify({ action: "upload", mime: "image/png", size: blob.size }),
    });
    const grant = await response.json();
    if (!response.ok) throw Error(grant.error || "Could not prepare upload.");
    const saved = await supabase.storage
      .from(grant.bucket)
      .uploadToSignedUrl(grant.path, grant.token, blob, { contentType: grant.contentType });
    if (saved.error) throw saved.error;
    return grant.path as string;
  }
  async function add(blob: Blob, citation: DrawingCitation) {
    await run("Saving selection", async () => {
      if (
        rows.some(
          (r) =>
            !r.result &&
            r.roomId === roomId &&
            r.citation.sourceKey === citation.sourceKey &&
            r.citation.page === citation.page &&
            JSON.stringify(r.citation.bounds) === JSON.stringify(citation.bounds),
        )
      )
        throw Error("This drawing area is already queued for this room.");
      const id = crypto.randomUUID();
      const sourcePath = await upload(roomId, blob);
      await api({
        action: "add",
        id,
        roomId,
        name:
          name.trim() ||
          `${rooms.find((r) => r.id === roomId)?.name} · ${citation.sheet} · ${citation.title}`,
        notes,
        sourcePath,
        citation,
      });
      await refresh();
      setSelected((old) => [...old, id]);
      setName("");
      setNotice("View added. Select another area or room, then prepare your batch.");
    });
  }
  async function prepare() {
    await run("Preparing full drawings and reference photos", async () => {
      const prepared = await api({ action: "prepare", ids: selected });
      const files: Record<string, Uint8Array> = {
        "START-HERE.txt": strToU8(CODEX_BATCH_INSTRUCTIONS),
      };
      const warnings: string[] = [];
      let total = 0;
      async function bytes(url: string, headers?: HeadersInit) {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw Error("A batch reference could not download. Try preparing again.");
        if (Number(res.headers.get("Content-Length")) > 64 * 1024 * 1024)
          throw Error("This document exceeds the pilot's 64 MB per-file limit.");
        const reader = res.body!.getReader(),
          chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          total += part.value.length;
          if (length > 64 * 1024 * 1024 || total > 160 * 1024 * 1024) {
            await reader.cancel();
            throw Error("Keep a pilot batch under 160 MB, with each file under 64 MB.");
          }
          chunks.push(part.value);
        }
        const result = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result;
      }
      const documents = [];
      const pdfsByHash = new Map<string, string>();
      for (const doc of prepared.documents) {
        const data = await bytes(doc.url);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        const file = pdfsByHash.get(hash) || `documents/${doc.id}.pdf`;
        if (!pdfsByHash.has(hash)) files[file] = data;
        pdfsByHash.set(hash, file);
        documents.push({ id: doc.id, title: doc.title, file, sha256: hash });
      }
      const items = [];
      const photos = new Map<string, string>();
      for (const row of prepared.items as Array<CodexBatchItem & { sourceUrl: string }>) {
        const { sourceUrl, sourcePath, ...item } = row;
        const sourceFile = `sources/${row.id}.png`;
        files[sourceFile] = await bytes(sourceUrl);
        const productFiles: Record<string, string> = {};
        for (const product of row.items.filter((p) => p.imageUrl)) {
          if (!photos.has(product.id)) {
            try {
              const photo = await bytes(
                `${endpoint}&item=${row.id}&product=${product.id}`,
                await studioHeaders(),
              );
              const file = `products/${product.id}.${codexReferenceExtension(photo)}`;
              files[file] = photo;
              photos.set(product.id, file);
            } catch {
              warnings.push(
                `${row.name}: photo unavailable for ${product.label} / ${product.name}. Product appearance must remain unverified.`,
              );
              photos.set(product.id, "");
            }
          }
          if (photos.get(product.id)) productFiles[product.id] = photos.get(product.id)!;
        }
        items.push({ ...item, sourceFile, productFiles });
      }
      const manifest = {
        version: 1,
        provider: "codex-subscription",
        projectId,
        projectName: prepared.projectName,
        preparedAt: new Date().toISOString(),
        maxAttemptsPerView: 2,
        documents,
        items,
        warnings,
      };
      files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
      const zip = zipSync(files, { level: 0 });
      const blob = new Blob([zip], { type: "application/zip" });
      setPreparedPackage({
        url: URL.createObjectURL(blob),
        filename: `MERAV-Codex-Batch-${Date.now()}.zip`,
        count: items.length,
      });
      setNotice(
        `Batch prepared: ${items.length} views. Download it using the link below, unzip it, attach START-HERE.txt in Codex with the folder location, and ask it to run the batch. Nothing has started rendering yet.${warnings.length ? ` ${warnings.length} product-photo issues are recorded for review.` : ""}`,
      );
    });
  }
  async function importResults(files: File[]) {
    await run("Importing reviewed results", async () => {
      const reportsFile = files.find((f) => f.name === "results.json");
      if (!reportsFile || reportsFile.size > 256 * 1024)
        throw Error("Choose results.json (under 256 KB) and its final PNG files together.");
      const payload = z
        .object({
          version: z.literal(1),
          projectId: z.literal(projectId),
          results: z.array(codexBatchReportSchema).min(1).max(20),
        })
        .parse(JSON.parse(await reportsFile.text()));
      if (new Set(payload.results.map((r) => r.itemId)).size !== payload.results.length)
        throw Error("Results contain duplicate view IDs.");
      const byName = new Map<string, File>();
      for (const f of files) {
        if (byName.has(f.name)) throw Error("Choose only one file with each name.");
        byName.set(f.name, f);
      }
      // Validate every item before starting uploads, then save each independently for resumable import.
      for (const report of payload.results) {
        const item = rows.find((r) => r.id === report.itemId);
        if (!item || item.fingerprint !== report.fingerprint)
          throw Error("These results do not match this project's saved selections.");
        const image = byName.get(`${report.itemId}.png`);
        if (report.status === "review" && !image) throw Error(`Missing ${report.itemId}.png`);
        if (image && image.size > 15 * 1024 * 1024) throw Error("Keep each final PNG under 15 MB.");
      }
      let saved = 0;
      try {
        for (const report of payload.results) {
          const item = rows.find((r) => r.id === report.itemId)!;
          if (item.result) continue;
          const image = byName.get(`${report.itemId}.png`),
            imagePath = image ? await upload(item.roomId, image) : undefined;
          await api({ action: "result", report, imagePath });
          saved++;
        }
      } finally {
        await refresh();
      }
      setNotice(
        `${saved} reviewed results saved privately. These remain drafts and are not approved for presentations.`,
      );
    });
  }
  return (
    <section aria-label="Codex rendering batch" className="border p-5 mb-8">
      <h2 className="font-display text-3xl">Codex batch · subscription pilot</h2>
      <p className="text-sm mt-2">
        Select views across rooms, then prepare one batch for Codex. This path makes no OpenAI API
        calls. Codex image generation uses your subscription allowance.
      </p>
      <p className="text-sm mt-2">
        Pilot handoff: download and unzip the batch, then give its folder to Codex. Codex renders
        sequentially, checks all seven categories, tries at most one correction per view, and
        continues past blocked views. Keep the computer awake and Codex open.
      </p>
      <div className="mt-4 flex flex-wrap gap-4">
        <label className="text-sm">
          Room
          <select
            aria-label="Batch room"
            className="block border p-2 mt-1"
            value={roomId}
            disabled={!!busy}
            onChange={(e) => {
              setRoomId(e.target.value);
              setName("");
              setNotes("");
            }}
          >
            <option value="">Choose room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex-1">
          View name (optional)
          <input
            aria-label="Batch view name"
            className="block w-full border p-2 mt-1"
            value={name}
            maxLength={180}
            disabled={!!busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kitchen — range wall"
          />
        </label>
      </div>
      <label className="block text-sm mt-4">
        Instructions and accepted assumptions for this view
        <textarea
          aria-label="Batch view instructions"
          className="block border w-full p-2 mt-1"
          value={notes}
          maxLength={2000}
          disabled={!!busy}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Camera direction, accepted scaled measurements, or anything that must remain fixed"
        />
      </label>
      <p className="text-xs mt-2 mb-4">
        Full source PDFs and frozen room Spec Book facts travel with each batch. No paid drawing
        scan is required.{" "}
        <a className="underline" href={`/projects/${projectId}/construction-docs`}>
          Upload or manage construction docs
        </a>
      </p>
      {roomId && (
        <ConstructionDrawingPicker
          key={`${projectId}:${roomId}`}
          projectId={projectId}
          roomId={roomId}
          disabled={!!busy}
          batchMode
          onChoose={add}
        />
      )}
      <div className="flex flex-wrap items-center gap-4 mt-4">
        <button
          disabled={!!busy || !rows.some((r) => !r.result)}
          className="underline text-sm"
          onClick={() =>
            setSelected(
              rows
                .filter((r) => !r.result)
                .slice(0, 20)
                .map((r) => r.id),
            )
          }
        >
          Select pending views (up to 20)
        </button>
        <button
          disabled={!!busy || !selected.length}
          className="bg-ink text-white px-4 py-3 disabled:opacity-40"
          onClick={() => void prepare()}
        >
          Prepare selected batch for Codex ({selected.length})
        </button>
        <label className="border p-3 text-sm">
          Import reviewed results
          <input
            aria-label="Import Codex batch results"
            type="file"
            accept=".json,.png"
            multiple
            disabled={!!busy}
            className="block mt-2 text-xs"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (files.length) void importResults(files);
            }}
          />
        </label>
        <button
          className="text-sm underline"
          disabled={!!busy}
          onClick={() => void run("Refreshing", refresh)}
        >
          Refresh batch
        </button>
      </div>
      {busy && (
        <p role="status" className="mt-3">
          {busy}…
        </p>
      )}
      {notice && (
        <p role="status" className="border bg-bone/30 p-3 mt-3 whitespace-pre-wrap">
          {notice}
        </p>
      )}
      {preparedPackage && (
        <a
          href={preparedPackage.url}
          download={preparedPackage.filename}
          className="inline-block border border-ink px-4 py-3 mt-3"
        >
          Download prepared batch ({preparedPackage.count} views)
        </a>
      )}
      {error && (
        <p role="alert" className="text-red-700 mt-3">
          {error}
        </p>
      )}
      <h3 className="font-display text-2xl mt-6">
        Selected views and reviewed drafts ({rows.length})
      </h3>
      {!rows.length && (
        <p className="text-sm mt-2">
          Add your first drawing area above. Queuing a view does not generate an image.
        </p>
      )}
      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        {rows.map((row) => (
          <article className="border p-4" key={row.id}>
            <label className="flex gap-2 items-start">
              <input
                type="checkbox"
                aria-label={`Include ${row.name} in batch`}
                checked={selected.includes(row.id)}
                disabled={!!busy || !!row.result}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked
                      ? [...old, row.id].slice(0, 20)
                      : old.filter((id) => id !== row.id),
                  )
                }
              />
              <strong>{row.name}</strong>
            </label>
            <p className="text-xs mt-2">
              {row.roomName} · {row.citation.sheet} · PDF page {row.citation.page}
            </p>
            <p className="text-sm mt-2">
              {row.result
                ? row.result.report.status === "blocked"
                  ? "Blocked — needs source information"
                  : "Draft — reviewed by Codex; needs your review"
                : "Queued — awaiting Codex handoff"}
            </p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                <img
                  src={row.sourceUrl}
                  alt={`${row.name} construction source`}
                  loading="lazy"
                  className="w-full max-h-60 object-contain"
                />
              </a>
              {row.result?.imageUrl && (
                <a href={row.result.imageUrl} target="_blank" rel="noreferrer">
                  <img
                    src={row.result.imageUrl}
                    alt={`${row.name} Codex draft`}
                    loading="lazy"
                    className="w-full max-h-60 object-contain"
                  />
                </a>
              )}
            </div>
            {row.notes && <p className="text-xs mt-2 whitespace-pre-wrap">{row.notes}</p>}
            {row.result && (
              <>
                <p className="text-sm mt-3">{row.result.report.summary}</p>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer">Source checks and unresolved details</summary>
                  <ul className="list-disc pl-5 mt-2 space-y-2">
                    {row.result.report.checks.map((c) => (
                      <li key={c.category}>
                        <strong>
                          {c.category}: {c.outcome}
                        </strong>{" "}
                        — {c.evidence}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2">{row.result.report.uncertainties.join(" ")}</p>
                  <p className="text-xs mt-2">
                    {row.result.report.attempts} image attempt(s). AI review does not verify
                    construction dimensions.
                  </p>
                </details>
              </>
            )}
            {!row.result && (
              <button
                className="underline text-xs mt-3"
                disabled={!!busy}
                onClick={() =>
                  void run("Removing from pending batch", async () => {
                    await api({ action: "remove", id: row.id });
                    await refresh();
                  })
                }
              >
                Remove from pending batch
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
