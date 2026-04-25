import { useId, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_DEFAULT_MODEL,
  type Provider,
} from "../lib/types";
import { ProviderDot } from "./ProviderChip";
import { StatusChip } from "./StatusChip";
import Spinner from "./Spinner";
import PageHeader from "./PageHeader";

export default function KeyManager() {
  const { keyStatus, setKeyStatus, pushToast } = useStore();
  const [drafts, setDrafts] = useState<Partial<Record<Provider, string>>>({});
  const [busy, setBusy] = useState<Provider | null>(null);
  const idBase = useId();

  async function refresh() {
    const ks = await api.getKeyStatus();
    setKeyStatus(Object.fromEntries(ks) as Record<Provider, boolean>);
  }

  async function save(p: Provider) {
    const v = (drafts[p] || "").trim();
    if (!v) return;
    setBusy(p);
    try {
      await api.setKey(p, v);
      setDrafts((d) => ({ ...d, [p]: "" }));
      await refresh();
      pushToast("success", `${PROVIDER_LABELS[p]} key saved`);
    } catch (e) {
      pushToast("error", String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(p: Provider) {
    setBusy(p);
    try {
      await api.deleteKey(p);
      await refresh();
      pushToast("info", `${PROVIDER_LABELS[p]} key removed`);
    } catch (e) {
      pushToast("error", String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-5 reveal">
      <PageHeader
        num="05"
        title="Keys"
        subtitle="Stored in your OS keyring. Never written to disk in plaintext."
      />

      <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const set = keyStatus[p];
          const inputId = `${idBase}-${p}`;
          return (
            <div key={p} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ProviderDot provider={p} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {PROVIDER_LABELS[p]}
                    </div>
                    <div className="text-[11px] text-muted font-mono truncate">
                      {PROVIDER_DEFAULT_MODEL[p]}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusChip status={set ? "success" : "neutral"}>
                    {set ? "configured" : "not set"}
                  </StatusChip>
                  {set && (
                    <button
                      className="btn-ghost"
                      disabled={busy === p}
                      onClick={() => remove(p)}
                    >
                      {busy === p && <Spinner label="removing" />}
                      {busy === p ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor={inputId}>
                  {PROVIDER_LABELS[p]} API key
                </label>
                <input
                  id={inputId}
                  type="password"
                  autoComplete="off"
                  className="input font-mono"
                  placeholder={set ? "Replace key…" : "Paste API key"}
                  value={drafts[p] || ""}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [p]: e.target.value }))
                  }
                  onKeyDown={(e) => e.key === "Enter" && save(p)}
                />
                <button
                  className="btn-primary"
                  disabled={busy === p || !(drafts[p] || "").trim()}
                  onClick={() => save(p)}
                >
                  {busy === p && <Spinner label="saving" />}
                  {busy === p ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
