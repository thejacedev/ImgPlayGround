import { useStore } from "../lib/store";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "../lib/types";
import { api } from "../lib/tauri";

function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center gap-0.5">
        {keys.map((k, i) => (
          <kbd key={i}>{k}</kbd>
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

export default function BottomBar() {
  const { tab, keyStatus, github } = useStore();
  const configured = Object.values(keyStatus).filter(Boolean).length;

  const githubSummary = (() => {
    if (!github) return "local only";
    if (!github.remote) return `@${github.username} · no repo`;
    const match = github.remote.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : github.remote;
  })();

  return (
    <div className="bottombar">
      <div className="flex items-center gap-1.5" aria-label="Provider status">
        {PROVIDERS.map((p: Provider) => (
          <span
            key={p}
            title={`${PROVIDER_LABELS[p]} — ${
              keyStatus[p] ? "configured" : "not set"
            }`}
            className="h-2 w-2 rounded-full shrink-0"
            style={{
              background: keyStatus[p]
                ? `var(--p-${p})`
                : "color-mix(in oklch, var(--muted), transparent 70%)",
            }}
          />
        ))}
        <span className="ml-2 tabular-nums">
          {configured}/{PROVIDERS.length}
        </span>
      </div>

      <span className="bottombar-sep" />

      {tab === "generate" && (
        <KeyHint keys={["⌘", "↵"]} label="generate" />
      )}
      {tab === "bulk" && (
        <KeyHint keys={["⌘", "↵"]} label="run batch" />
      )}
      {(tab === "keys") && (
        <KeyHint keys={["↵"]} label="save key" />
      )}

      <span className="ml-auto flex items-center gap-2">
        {github && (
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{
              background: github.remote
                ? "var(--success)"
                : "color-mix(in oklch, var(--muted), transparent 60%)",
            }}
          />
        )}
        <button
          type="button"
          className="hover:text-ink transition-colors"
          onClick={() =>
            github?.remote
              ? api.openExternal(
                  github.remote.replace(/\.git$/, "").replace(
                    /^https:\/\/x-access-token:[^@]+@/,
                    "https://"
                  )
                )
              : undefined
          }
          disabled={!github?.remote}
          style={{ transitionDuration: "var(--dur-fast)" }}
          title={github?.remote ? "Open on GitHub" : "Connect GitHub in Settings"}
        >
          {githubSummary}
        </button>
      </span>
    </div>
  );
}
