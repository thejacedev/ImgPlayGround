import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import type { QueueJob, QueueStatus } from "../lib/types";
import { ProviderChip } from "./ProviderChip";
import PageHeader from "./PageHeader";
import Spinner from "./Spinner";

type Filter = "all" | "active" | "succeeded" | "failed";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "succeeded", label: "Done" },
  { id: "failed", label: "Failed" },
];

const STATUS_LABEL: Record<QueueStatus, string> = {
  pending: "queued",
  running: "running",
  succeeded: "done",
  failed: "failed",
  cancelled: "cancelled",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const isActive = (j: QueueJob) =>
  j.status === "pending" || j.status === "running";

export default function Queue() {
  const { queue, removeQueueJobs, bulkBusy, pushToast } = useStore();
  const [filter, setFilter] = useState<Filter>("all");

  const activeCount = useMemo(
    () => queue.filter(isActive).length,
    [queue]
  );

  // Tick once a second while jobs are active so elapsed-time displays
  // update live. The tick state is unused — its only job is to trigger a
  // re-render so QueueRow recomputes Date.now() - startedAt.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (activeCount === 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeCount]);

  const filtered = useMemo(() => {
    if (filter === "all") return queue;
    if (filter === "active") return queue.filter(isActive);
    if (filter === "failed")
      return queue.filter(
        (j) => j.status === "failed" || j.status === "cancelled"
      );
    return queue.filter((j) => j.status === "succeeded");
  }, [queue, filter]);

  async function cancelBatch() {
    try {
      const wasActive = await api.cancelBulk();
      pushToast(
        "info",
        wasActive
          ? "Cancelling pending jobs — in-flight requests still finish."
          : "Nothing to cancel."
      );
    } catch (e) {
      pushToast("error", String(e));
    }
  }

  function clearDone() {
    const ids = queue.filter((j) => !isActive(j)).map((j) => j.id);
    if (ids.length === 0) return;
    removeQueueJobs(ids);
  }

  const hasDone = queue.some((j) => !isActive(j));

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-5 reveal">
      <PageHeader
        num="03"
        title="Queue"
        subtitle={
          queue.length === 0
            ? "Generate or run a batch — jobs land here while they work."
            : `${activeCount} active · ${queue.length} total`
        }
        right={
          <>
            <button
              className="btn"
              onClick={cancelBatch}
              disabled={!bulkBusy}
              title={
                bulkBusy
                  ? "Stop dispatching pending bulk jobs (in-flight ones complete)"
                  : "No active batch"
              }
            >
              Cancel batch
            </button>
            <button
              className="btn"
              onClick={clearDone}
              disabled={!hasDone}
              title="Remove completed, failed, and cancelled jobs from this list"
            >
              Clear done
            </button>
          </>
        }
      />

      <div className="flex items-center gap-2">
        {FILTERS.map((f) => {
          const count =
            f.id === "all"
              ? queue.length
              : f.id === "active"
              ? activeCount
              : f.id === "failed"
              ? queue.filter(
                  (j) => j.status === "failed" || j.status === "cancelled"
                ).length
              : queue.filter((j) => j.status === "succeeded").length;
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={on}
              className={`queue-filter ${on ? "is-on" : ""}`}
            >
              {f.label}
              <span className="queue-filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="queue-empty font-display italic text-2xl text-muted text-center py-16">
          {queue.length === 0 ? "Nothing queued." : "Nothing here."}
          <div className="text-xs not-italic font-sans mt-2">
            {queue.length === 0
              ? "Run a Generate or Bulk job to populate this list."
              : "Try a different filter."}
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((j) => (
            <li key={j.id}>
              <QueueRow
                job={j}
                onRemove={() => removeQueueJobs([j.id])}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueRow({ job, onRemove }: { job: QueueJob; onRemove: () => void }) {
  const { pushToast } = useStore();
  const active = isActive(job);
  const elapsed = job.endedAt
    ? job.endedAt - job.startedAt
    : Date.now() - job.startedAt;

  function open() {
    if (job.paths[0]) api.openInSystem(job.paths[0]);
  }

  function copyError() {
    if (!job.error) return;
    navigator.clipboard.writeText(job.error).then(
      () => pushToast("info", "Error copied"),
      () => pushToast("error", "Couldn't copy")
    );
  }

  return (
    <div className={`queue-row queue-row-${job.status}`}>
      <div className="queue-row-meta">
        <ProviderChip provider={job.provider} size="xs" />
        <span className={`queue-status queue-status-${job.status}`}>
          {STATUS_LABEL[job.status]}
        </span>
        <span className="queue-source">{job.source}</span>
      </div>

      <div className="queue-row-prompt" title={job.prompt}>
        {job.prompt || "(no prompt)"}
      </div>

      {job.error && (
        <button
          type="button"
          className="queue-row-error"
          title="Click to copy"
          onClick={copyError}
        >
          {job.error}
        </button>
      )}

      <div className="queue-row-foot">
        <span className="tabular-nums">{formatTime(job.startedAt)}</span>
        <span className="opacity-60 mx-1.5">·</span>
        <span className="tabular-nums">{formatDuration(elapsed)}</span>
        {job.paths.length > 0 && (
          <>
            <span className="opacity-60 mx-1.5">·</span>
            <span className="tabular-nums">
              {job.paths.length} file{job.paths.length === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>

      <div className="queue-row-actions">
        {job.status === "succeeded" && job.paths[0] && (
          <button className="btn-ghost text-xs" onClick={open}>
            Open
          </button>
        )}
        {active ? (
          <span className="queue-row-spin" aria-label="in flight">
            <Spinner />
          </span>
        ) : (
          <button
            className="btn-ghost text-xs"
            onClick={onRemove}
            aria-label="Remove from queue"
            title="Remove from queue"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
