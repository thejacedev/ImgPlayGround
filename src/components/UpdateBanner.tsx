import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useStore } from "../lib/store";
import Spinner from "./Spinner";

type State =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | {
      kind: "downloading";
      update: Update;
      downloaded: number;
      total: number;
    }
  | { kind: "ready"; update: Update }
  | { kind: "dismissed" };

export default function UpdateBanner() {
  const pushToast = useStore((s) => s.pushToast);
  const [state, setState] = useState<State>({ kind: "idle" });

  // Probe once on app launch. Quiet on failure — a missing GitHub release
  // shouldn't ever surface a scary error to the user.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (!cancelled && update) {
          setState({ kind: "available", update });
        }
      } catch {
        // network blip, no release yet, etc. — ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function install() {
    if (state.kind !== "available") return;
    const update = state.update;
    let downloaded = 0;
    let total = 0;
    setState({ kind: "downloading", update, downloaded: 0, total: 0 });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
        }
        setState({ kind: "downloading", update, downloaded, total });
      });
      setState({ kind: "ready", update });
    } catch (e) {
      pushToast("error", `Update failed: ${String(e)}`);
      setState({ kind: "available", update });
    }
  }

  if (state.kind === "idle" || state.kind === "dismissed") return null;

  const update =
    state.kind === "available" || state.kind === "downloading" || state.kind === "ready"
      ? state.update
      : null;
  if (!update) return null;

  const pct =
    state.kind === "downloading" && state.total > 0
      ? Math.round((state.downloaded / state.total) * 100)
      : 0;

  const kicker =
    state.kind === "ready"
      ? "Update ready"
      : state.kind === "downloading"
      ? "Downloading"
      : "Update available";

  const headline =
    state.kind === "ready"
      ? `Restart to install v${update.version}`
      : state.kind === "downloading"
      ? `v${update.version}`
      : `v${update.version} is out`;

  return (
    <div
      className="update-banner"
      role="status"
      aria-live="polite"
      aria-busy={state.kind === "downloading"}
    >
      <div className="update-banner-text">
        <div className="text-[10px] font-mono uppercase tracking-[0.08em] text-muted">
          {kicker}
        </div>
        <div className="font-display italic text-base leading-tight mt-0.5">
          {headline}
        </div>
        {state.kind === "downloading" && (
          <div className="progress-track running mt-2 w-44">
            <div
              className="progress-fill"
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {state.kind === "available" && (
          <>
            <button
              className="btn-ghost text-xs"
              onClick={() => setState({ kind: "dismissed" })}
            >
              Later
            </button>
            <button className="btn-primary" onClick={install}>
              Install
            </button>
          </>
        )}
        {state.kind === "downloading" && (
          <button className="btn-primary" disabled aria-label="Downloading">
            <Spinner />
            <span className="tabular-nums">
              {state.total > 0 ? `${pct}%` : "…"}
            </span>
          </button>
        )}
        {state.kind === "ready" && (
          <>
            <button
              className="btn-ghost text-xs"
              onClick={() => setState({ kind: "dismissed" })}
            >
              Not now
            </button>
            <button className="btn-primary" onClick={() => relaunch()}>
              Restart
            </button>
          </>
        )}
      </div>
    </div>
  );
}
