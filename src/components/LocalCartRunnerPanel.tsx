import { useState } from "react";
import type { RunnerApproval, useLocalCartRunner } from "@/lib/localCartRunner";

export function LocalCartRunnerPanel({
  runner,
}: {
  runner: ReturnType<typeof useLocalCartRunner>;
}) {
  return (
    <div className="mt-5 border border-border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">Build carts from Studio</div>
          <p
            className={`mt-1 text-sm ${runner.ready ? "text-emerald-800" : "text-muted-foreground"}`}
          >
            {runner.ready
              ? "Local runner connected"
              : runner.health.isFetching
                ? "Checking the local runner…"
                : runner.health.data?.message || "Local runner not connected"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => runner.health.refetch()}
          className="border border-border px-3 py-2 text-xs"
        >
          Check connection
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Keep the cart runner and Chrome open on this computer. Select products, then click Build
        Carts. Build Carts includes access to the selected retailer sites for this run. Progress and
        questions appear here. Checkout and sending emails remain manual.
      </p>
      {!runner.ready && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">Connect this computer</summary>
          <p className="mt-2 text-muted-foreground">
            Open MERAV Cart Runner on the computer where you use Chrome, then check the connection.
            If Chrome requests access to your local network, allow it for Studio. The runner must
            have the Merav Cart Builder and Chrome tools enabled in Codex.
          </p>
        </details>
      )}
      {runner.error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {runner.error}
        </p>
      )}
      {runner.run && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <div role="status" className="font-medium">
              {
                {
                  starting: "Starting carts…",
                  running: "Building carts…",
                  needs_attention: "Your input is needed",
                  finished: "Runner finished — review cart results below",
                  failed: "Runner stopped with an issue",
                  stopped: "Runner stopped",
                  interrupted: "Runner interrupted — review carts before retrying",
                }[runner.run.status]
              }
            </div>
            {runner.active && (
              <button
                type="button"
                onClick={runner.stop}
                disabled={runner.busy}
                className="border border-border px-3 py-2 text-xs disabled:opacity-40"
              >
                Stop runner
              </button>
            )}
          </div>
          <div className="mt-2 max-h-44 overflow-auto space-y-2 text-sm text-muted-foreground">
            {runner.run.messages.map((message, index) => (
              <p key={index} className="whitespace-pre-wrap">
                {message}
              </p>
            ))}
          </div>
          {runner.run.approvals.map((approval) => (
            <RunnerQuestion
              key={approval.id}
              approval={approval}
              busy={runner.busy}
              answer={runner.answer}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunnerQuestion({
  approval,
  busy,
  answer,
}: {
  approval: RunnerApproval;
  busy: boolean;
  answer: (body: unknown) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  return (
    <form
      className="mt-4 space-y-3 border border-amber-300 bg-amber-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const defaults = Object.fromEntries(
          Object.entries(approval.schema?.properties || {})
            .filter(([, field]) => field.type === "boolean")
            .map(([key]) => [key, false]),
        );
        void answer(
          approval.kind === "pause"
            ? { requestId: approval.id, action: "continue" }
            : approval.kind === "questions"
              ? { requestId: approval.id, answers: values }
              : { requestId: approval.id, action: "accept", content: { ...defaults, ...values } },
        );
      }}
    >
      {approval.message && <p className="text-sm">{approval.message}</p>}
      {approval.questions?.map((question) => (
        <label key={question.id} className="block text-sm">
          {question.question}
          <input
            required
            value={String(values[question.id] || "")}
            onChange={(event) => setValues({ ...values, [question.id]: event.target.value })}
            list={`cart-answer-${approval.id}-${question.id}`}
            className="mt-2 block w-full border border-input bg-white p-2"
          />
          <datalist id={`cart-answer-${approval.id}-${question.id}`}>
            {question.options?.map((option) => (
              <option key={option.label} value={option.label}>
                {option.description}
              </option>
            ))}
          </datalist>
        </label>
      ))}
      {Object.entries(approval.schema?.properties || {}).map(([key, field]) => (
        <label key={key} className="block text-sm">
          {field.title || key}
          {field.description && (
            <span className="block text-xs text-muted-foreground">{field.description}</span>
          )}
          {field.type === "boolean" ? (
            <input
              type="checkbox"
              checked={values[key] === true}
              onChange={(event) => setValues({ ...values, [key]: event.target.checked })}
              className="ml-2"
            />
          ) : field.enum ? (
            <select
              required={approval.schema?.required?.includes(key)}
              value={String(values[key] || "")}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
              className="mt-1 block border border-input bg-white p-2"
            >
              <option value="">Choose…</option>
              {field.enum.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          ) : (
            <input
              required={approval.schema?.required?.includes(key)}
              value={String(values[key] || "")}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
              className="mt-1 block w-full border border-input bg-white p-2"
            />
          )}
        </label>
      ))}
      <div className="flex gap-2">
        <button
          disabled={busy}
          type="submit"
          className="bg-ink px-4 py-2 text-sm text-primary-foreground disabled:opacity-40"
        >
          {approval.kind === "pause"
            ? "I've resolved it — Continue"
            : approval.kind === "questions"
              ? "Continue"
              : "Approve this request"}
        </button>
        {approval.kind === "approval" && (
          <button
            disabled={busy}
            type="button"
            onClick={() => answer({ requestId: approval.id, action: "decline" })}
            className="border border-border bg-white px-4 py-2 text-sm"
          >
            Decline
          </button>
        )}
      </div>
    </form>
  );
}
