import { useId } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import GitHubSection from "./GitHubSection";
import PageHeader from "./PageHeader";

export default function Settings() {
  const { outputDir, setOutputDir, gitEnabled, setGitEnabled, pushToast } =
    useStore();
  const ids = useId();

  async function pick() {
    const p = await api.pickDir();
    if (p) {
      await api.setOutputDir(p);
      setOutputDir(p);
      pushToast("success", "Output directory updated");
    }
  }

  async function toggleGit(v: boolean) {
    await api.setGitEnabled(v);
    setGitEnabled(v);
    pushToast("info", v ? "Git auto-commit enabled" : "Git auto-commit off");
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-5 reveal">
      <PageHeader
        num="05"
        title="Settings"
        subtitle="Where images land, and whether to push them anywhere."
      />

      <div className="card p-5 space-y-4">
        <div>
          <label className="label block mb-1.5" htmlFor={`${ids}-dir`}>
            Output directory
          </label>
          <div className="flex gap-2">
            <input
              id={`${ids}-dir`}
              className="input font-mono text-xs"
              value={outputDir}
              readOnly
            />
            <button className="btn" onClick={pick}>
              Pick…
            </button>
            <button
              className="btn-ghost"
              onClick={() => outputDir && api.openInSystem(outputDir)}
              disabled={!outputDir}
            >
              Open
            </button>
          </div>
          <p className="text-xs text-muted mt-2 leading-relaxed">
            Images land at{" "}
            <code>
              {outputDir || "{output}"}/generated/&#123;provider&#125;/&#123;YYYY-MM-DD&#125;/&#123;slug&#125;-&#123;hash&#125;.png
            </code>{" "}
            with a matching <code>.json</code> sidecar.
          </p>
        </div>

        <div className="border-t border-border pt-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={gitEnabled}
              onChange={(e) => toggleGit(e.target.checked)}
              className="h-4 w-4 mt-0.5 accent-[color:var(--accent)]"
            />
            <div>
              <div className="text-sm font-medium">
                Auto-commit generated images to git
              </div>
              <div className="text-xs text-muted mt-0.5 leading-relaxed">
                On each batch, runs <code>git init</code> (if needed) in the
                output dir and commits new files. If GitHub sync is configured
                below, it also pushes.
              </div>
            </div>
          </label>
        </div>
      </div>

      <GitHubSection />
    </div>
  );
}
