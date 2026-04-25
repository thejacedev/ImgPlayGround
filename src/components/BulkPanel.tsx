import { useId, useMemo, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  SIZES,
  type Provider,
} from "../lib/types";
import { ProviderChip, ProviderDot } from "./ProviderChip";
import Spinner from "./Spinner";
import PageHeader from "./PageHeader";
import BulkGauge, { type JobState } from "./BulkGauge";

export default function BulkPanel() {
  const {
    keyStatus,
    pushToast,
    bulkBusy,
    bulkProgress,
    bulkJobs,
    bulkResults,
    setBulk,
  } = useStore();
  const [prompts, setPrompts] = useState("");
  const [selected, setSelected] = useState<Set<Provider>>(new Set(["openai"]));
  const [n, setN] = useState(1);
  const [size, setSize] = useState<(typeof SIZES)[number]>("1024x1024");
  const [concurrency, setConcurrency] = useState(3);
  const ids = useId();

  function toggle(p: Provider) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  const activeProviders = useMemo(
    () => PROVIDERS.filter((p) => selected.has(p) && keyStatus[p]),
    [selected, keyStatus]
  );

  const promptsList = useMemo(
    () => prompts.split("\n").map((s) => s.trim()).filter(Boolean),
    [prompts]
  );

  async function run() {
    if (promptsList.length === 0) {
      pushToast("error", "No prompts entered");
      return;
    }
    const skipped = [...selected].filter((p) => !keyStatus[p]);
    if (activeProviders.length === 0) {
      pushToast("error", "No selected providers have keys configured");
      return;
    }
    if (skipped.length > 0) {
      pushToast(
        "info",
        `Skipping (no key): ${skipped.map((p) => PROVIDER_LABELS[p]).join(", ")}`
      );
    }

    const allJobs: JobState[] = activeProviders.flatMap((p) =>
      promptsList.map<JobState>(() => ({ provider: p, status: "pending" }))
    );
    setBulk({
      busy: true,
      jobs: allJobs,
      results: [],
      progress: { total: allJobs.length, completed: 0, failed: 0 },
    });
    try {
      const res = await api.generateBulk({
        prompts: promptsList,
        providers: activeProviders,
        n,
        size,
        concurrency,
      });
      setBulk({ busy: false, results: res });
      const ok = res.filter((r) => !r.error).length;
      pushToast("success", `Done — ${ok}/${res.length} jobs succeeded`);
    } catch (e) {
      setBulk({ busy: false });
      pushToast("error", String(e));
    }
  }

  const pct =
    bulkProgress.total > 0
      ? Math.round(
          ((bulkProgress.completed + bulkProgress.failed) /
            bulkProgress.total) *
            100
        )
      : 0;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-5 reveal">
      <PageHeader
        num="02"
        title="Bulk"
        subtitle="One prompt per line. Every prompt runs against every selected provider."
      />

      <div className="card p-5 space-y-4">
        <div>
          <label className="label block mb-1.5" htmlFor={`${ids}-prompts`}>
            Prompts
          </label>
          <textarea
            id={`${ids}-prompts`}
            className="input min-h-[180px] font-mono text-xs leading-relaxed"
            placeholder={
              "a golden retriever in a space suit\na brutalist cathedral at sunset\nisometric tiny cyberpunk diner"
            }
            value={prompts}
            onChange={(e) => setPrompts(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!bulkBusy && prompts.trim()) run();
              }
            }}
          />
        </div>

        <div>
          <div className="label mb-1.5">Providers</div>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p) => {
              const on = selected.has(p);
              const hasKey = keyStatus[p];
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(p)}
                  aria-pressed={on}
                  className={`btn ${!hasKey ? "opacity-55" : ""}`}
                  style={
                    on
                      ? {
                          background: "var(--accent)",
                          color: "var(--accent-ink)",
                          borderColor: "var(--accent)",
                        }
                      : undefined
                  }
                  title={hasKey ? undefined : "No key — will be skipped"}
                >
                  <ProviderDot provider={p} size="xs" />
                  <span>{PROVIDER_LABELS[p]}</span>
                  {!hasKey && (
                    <span className="text-[10px] opacity-80 ml-0.5">· no key</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label block mb-1.5" htmlFor={`${ids}-size`}>
              Size
            </label>
            <select
              id={`${ids}-size`}
              className="input"
              value={size}
              onChange={(e) =>
                setSize(e.target.value as (typeof SIZES)[number])
              }
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1.5" htmlFor={`${ids}-n`}>
              Images per prompt
            </label>
            <input
              id={`${ids}-n`}
              type="number"
              min={1}
              max={10}
              className="input"
              value={n}
              onChange={(e) => setN(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
          <div>
            <label className="label block mb-1.5" htmlFor={`${ids}-c`}>
              Concurrency
            </label>
            <input
              id={`${ids}-c`}
              type="number"
              min={1}
              max={10}
              className="input"
              value={concurrency}
              onChange={(e) =>
                setConcurrency(Math.max(1, parseInt(e.target.value) || 1))
              }
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs font-mono text-muted tabular-nums">
            {bulkBusy
              ? `${bulkProgress.completed}/${bulkProgress.total} done · ${bulkProgress.failed} failed · ${pct}%`
              : bulkJobs.length > 0
              ? `${bulkProgress.completed + bulkProgress.failed}/${
                  bulkProgress.total
                } complete`
              : promptsList.length > 0 && activeProviders.length > 0
              ? `${promptsList.length} × ${activeProviders.length} = ${
                  promptsList.length * activeProviders.length
                } jobs queued`
              : "Ready."}
          </div>
          <button
            className="btn-primary"
            disabled={bulkBusy || !prompts.trim()}
            onClick={run}
          >
            {bulkBusy && <Spinner label="running batch" />}
            {bulkBusy ? "Running…" : "Run batch"}
          </button>
        </div>

        {bulkJobs.length > 0 && <BulkGauge jobs={bulkJobs} />}
      </div>

      {bulkResults.length > 0 && (
        <div className="card p-4 space-y-2 reveal">
          <div className="font-medium text-sm">Results</div>
          <div className="max-h-96 overflow-auto text-xs font-mono space-y-1">
            {bulkResults.map((r, i) => {
              const p = r.provider as Provider;
              const text = r.error ? `error: ${r.error}` : r.paths.join(", ");
              return (
                <div
                  key={`${r.provider}-${i}`}
                  className="flex gap-3 items-center py-0.5"
                  style={r.error ? { color: "var(--danger)" } : undefined}
                >
                  <span className="w-44 shrink-0 flex items-center">
                    <ProviderChip provider={p} size="xs" />
                  </span>
                  <span className="flex-1 truncate" title={text}>
                    {text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
