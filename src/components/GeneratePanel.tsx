import { useEffect, useId, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_COLORS,
  PROVIDER_DEFAULT_MODEL,
  SIZES,
  type Provider,
} from "../lib/types";
import { ProviderDot } from "./ProviderChip";
import Spinner from "./Spinner";
import PageHeader from "./PageHeader";

export default function GeneratePanel() {
  const {
    keyStatus,
    pushToast,
    models,
    setModels,
    genBusy,
    genResults,
    setGen,
    addQueueJobs,
    updateQueueJob,
  } = useStore();
  const [provider, setProvider] = useState<Provider>("openai");
  const [prompt, setPrompt] = useState("");
  const [n, setN] = useState(1);
  const [size, setSize] = useState<(typeof SIZES)[number]>("1024x1024");
  const [model, setModel] = useState("");
  const [openaiBackground, setOpenaiBackground] =
    useState<"auto" | "opaque" | "transparent">("auto");
  const [refreshingModels, setRefreshingModels] = useState(false);
  const ids = useId();

  useEffect(() => {
    if (models[provider]) return;
    api
      .listModels(provider)
      .then((list) => setModels(provider, list))
      .catch(() => {});
  }, [provider, models, setModels]);

  async function refreshModels() {
    setRefreshingModels(true);
    try {
      const list = await api.listModels(provider, true);
      setModels(provider, list);
      pushToast(
        "info",
        `${PROVIDER_LABELS[provider]} · ${list.length} model${
          list.length === 1 ? "" : "s"
        }`
      );
    } catch (e) {
      pushToast("error", `Couldn't refresh models: ${String(e)}`);
    } finally {
      setRefreshingModels(false);
    }
  }

  async function run() {
    if (!prompt.trim()) return;
    if (!keyStatus[provider]) {
      pushToast("error", `No key set for ${PROVIDER_LABELS[provider]}`);
      return;
    }
    const jobId = crypto.randomUUID();
    addQueueJobs([
      {
        id: jobId,
        source: "generate",
        provider,
        prompt,
        status: "running",
        startedAt: Date.now(),
        endedAt: null,
        paths: [],
        error: null,
      },
    ]);
    setGen({ busy: true });
    try {
      const extra =
        provider === "openai" && openaiBackground !== "auto"
          ? { background: openaiBackground }
          : undefined;
      const res = await api.generateSingle({
        provider,
        prompt,
        n,
        size,
        model: model.trim() || undefined,
        extra,
      });
      if (res.error) {
        updateQueueJob(jobId, {
          status: "failed",
          endedAt: Date.now(),
          error: res.error,
        });
        pushToast("error", res.error);
        setGen({ busy: false });
        return;
      }
      const withB64 = await Promise.all(
        res.paths.map(async (p) => ({
          path: p,
          b64: await api.readImageB64(p),
          provider,
        }))
      );
      updateQueueJob(jobId, {
        status: "succeeded",
        endedAt: Date.now(),
        paths: res.paths,
      });
      setGen({ busy: false, results: withB64 });
      pushToast("success", `${res.paths.length} image(s) saved`);
    } catch (e) {
      updateQueueJob(jobId, {
        status: "failed",
        endedAt: Date.now(),
        error: String(e),
      });
      setGen({ busy: false });
      pushToast("error", String(e));
    }
  }

  const heroTc = `var(${PROVIDER_COLORS[provider]})`;

  const hero =
    genBusy && genResults.length === 0 ? (
      <div className="hero-thinking">
        <div className="hero-thinking-label">
          <span>Generating</span>
          <span className="hero-thinking-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </div>
        <div className="hero-thinking-sub">
          {PROVIDER_LABELS[provider]} · {size} · {n} image{n === 1 ? "" : "s"}
        </div>
      </div>
    ) : genResults.length > 0 ? (
      <div
        className="grid gap-3 p-3"
        style={{
          gridTemplateColumns:
            genResults.length === 1
              ? "1fr"
              : `repeat(${Math.min(genResults.length, 3)}, minmax(0, 1fr))`,
        }}
      >
        {genResults.map((r, i) => (
          <button
            key={r.path}
            type="button"
            className="thumb-wrap thumb-pop-hero text-left"
            style={
              {
                animationDelay: `${i * 90}ms`,
                ["--tc" as string]: `var(${PROVIDER_COLORS[r.provider]})`,
              } as React.CSSProperties
            }
            onClick={() => api.openInSystem(r.path)}
            aria-label={`Open ${prompt}`}
          >
            <img
              src={`data:image/png;base64,${r.b64}`}
              className="thumb"
              alt={prompt}
            />
            <div
              className="px-2.5 py-2 text-[11px] text-muted truncate font-mono"
              title={r.path}
            >
              {r.path.split("/").pop() ?? r.path}
            </div>
          </button>
        ))}
      </div>
    ) : (
      <div className="hero-canvas-empty">
        <div className="font-display italic text-2xl text-muted">
          Empty canvas.
        </div>
        <div className="text-xs">
          Type a prompt.{" "}
          <span className="kbd">⌘</span>
          <span className="kbd">↵</span> sends.
        </div>
      </div>
    );

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-5 reveal">
      <PageHeader
        num="01"
        title="Generate"
        subtitle={
          <>
            One prompt, one provider.{" "}
            <span className="font-mono text-[11px]">⌘↵</span> to send.
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <ProviderDot provider={provider} />
            <span className="text-xs text-muted font-mono">
              {PROVIDER_LABELS[provider]}
            </span>
          </div>
        }
      />

      <div
        className={`hero-canvas relative ${genBusy ? "is-busy" : ""}`}
        style={{ ["--tc" as string]: heroTc } as React.CSSProperties}
      >
        {hero}
      </div>

      <div className="card p-4 grid grid-cols-12 gap-3">
        <div className="col-span-12">
          <label className="label block mb-1.5" htmlFor={`${ids}-prompt`}>
            Prompt
          </label>
          <textarea
            id={`${ids}-prompt`}
            className="input min-h-[80px] resize-y"
            placeholder="A tiny astronaut sipping coffee on a neon asteroid…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!genBusy && prompt.trim()) run();
              }
            }}
          />
        </div>

        <div className="col-span-4">
          <label className="label block mb-1.5" htmlFor={`${ids}-provider`}>
            Provider
          </label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <ProviderDot provider={provider} size="xs" />
            </span>
            <select
              id={`${ids}-provider`}
              className="input pl-7"
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                  {keyStatus[p] ? "" : " · no key"}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="col-span-3">
          <label className="label block mb-1.5" htmlFor={`${ids}-size`}>
            Size / aspect
          </label>
          <select
            id={`${ids}-size`}
            className="input"
            value={size}
            onChange={(e) => setSize(e.target.value as (typeof SIZES)[number])}
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2">
          <label className="label block mb-1.5" htmlFor={`${ids}-n`}>
            Count
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

        <div className="col-span-3">
          <label
            className="label mb-1.5 flex items-center justify-between"
            htmlFor={`${ids}-model`}
          >
            <span>Model</span>
            <button
              type="button"
              onClick={refreshModels}
              disabled={refreshingModels}
              className="text-[10px] normal-case tracking-normal text-muted hover:text-ink disabled:opacity-60"
              title="Refresh model list"
            >
              {refreshingModels ? "…" : "↻"}
            </button>
          </label>
          <input
            id={`${ids}-model`}
            className="input font-mono text-xs"
            placeholder={PROVIDER_DEFAULT_MODEL[provider]}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list={`${ids}-model-list`}
            autoComplete="off"
            spellCheck={false}
          />
          <datalist id={`${ids}-model-list`}>
            {(models[provider] ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label !== m.id ? m.label : ""}
              </option>
            ))}
          </datalist>
        </div>

        {provider === "openai" && (
          <div className="col-span-4">
            <label
              className="label block mb-1.5"
              htmlFor={`${ids}-bg`}
              title="OpenAI bakes a background into the PNG unless you ask for transparency."
            >
              Background
            </label>
            <select
              id={`${ids}-bg`}
              className="input"
              value={openaiBackground}
              onChange={(e) =>
                setOpenaiBackground(
                  e.target.value as "auto" | "opaque" | "transparent"
                )
              }
            >
              <option value="auto">Auto</option>
              <option value="opaque">Opaque</option>
              <option value="transparent">Transparent (PNG)</option>
            </select>
          </div>
        )}

        <div className="col-span-12 flex justify-end">
          <button
            className={`btn-primary ${genBusy ? "is-busy" : ""}`}
            disabled={genBusy || !prompt.trim()}
            onClick={run}
          >
            {genBusy && <Spinner label="generating" />}
            {genBusy ? "Generating…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
