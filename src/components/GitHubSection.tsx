import { useEffect, useId, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import type { GhRepo } from "../lib/types";
import Spinner from "./Spinner";
import { StatusChip } from "./StatusChip";

type Mode = "idle" | "connecting" | "creating";

export default function GitHubSection() {
  const { github, setGithub, pushToast } = useStore();
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [showConnect, setShowConnect] = useState(false);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [newName, setNewName] = useState("imgplayground-outputs");
  const [newPrivate, setNewPrivate] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const ids = useId();

  const connected = !!github;
  const activeRepo = connected
    ? repos.find((r) => r.clone_url === github.remote)
    : undefined;

  useEffect(() => {
    if (connected) loadRepos();
  }, [connected]);

  async function loadRepos() {
    setLoadingRepos(true);
    try {
      setRepos(await api.githubListRepos());
    } catch (e) {
      pushToast("error", `Couldn't list repos: ${String(e)}`);
    } finally {
      setLoadingRepos(false);
    }
  }

  async function connect() {
    const t = token.trim();
    if (!t) return;
    setMode("connecting");
    try {
      const username = await api.githubConnect(t);
      setGithub({ username, remote: github?.remote ?? null });
      setToken("");
      setShowConnect(false);
      pushToast("success", `Connected as @${username}`);
    } catch (e) {
      pushToast("error", `Connect failed: ${String(e)}`);
    } finally {
      setMode("idle");
    }
  }

  async function disconnect() {
    try {
      await api.githubDisconnect();
      setGithub(null);
      setRepos([]);
      pushToast("info", "Disconnected from GitHub");
    } catch (e) {
      pushToast("error", String(e));
    }
  }

  async function pickRepo(cloneUrl: string) {
    if (!cloneUrl) {
      await api.githubClearRemote();
      setGithub(github ? { ...github, remote: null } : null);
      pushToast("info", "Sync set to local only");
      return;
    }
    try {
      await api.githubSetRemote(cloneUrl);
      setGithub(github ? { ...github, remote: cloneUrl } : null);
      const repo = repos.find((r) => r.clone_url === cloneUrl);
      pushToast(
        "success",
        `Syncing to ${repo ? repo.full_name : cloneUrl}`
      );
    } catch (e) {
      pushToast("error", String(e));
    }
  }

  async function createRepo() {
    const n = newName.trim();
    if (!n) return;
    setMode("creating");
    try {
      const repo = await api.githubCreateRepo(n, newPrivate);
      setRepos((r) => [repo, ...r]);
      await pickRepo(repo.clone_url);
      setShowNew(false);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("403") || msg.includes("Resource not accessible")) {
        pushToast(
          "error",
          "Token can't create repos. Use a classic token with the 'repo' scope, or add 'Administration: Read/Write' to your fine-grained token."
        );
      } else {
        pushToast("error", `Create failed: ${msg}`);
      }
    } finally {
      setMode("idle");
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">GitHub sync</div>
          <p className="text-xs text-muted mt-0.5 leading-relaxed">
            Optional. Commits push to a repo on your GitHub account after every
            batch.
          </p>
        </div>
        {connected ? (
          <div className="flex items-center gap-2 shrink-0">
            <StatusChip status="success">@{github.username}</StatusChip>
            <button className="btn-ghost" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          !showConnect && (
            <button className="btn" onClick={() => setShowConnect(true)}>
              Connect GitHub
            </button>
          )
        )}
      </div>

      {!connected && showConnect && (
        <div className="border-t border-border pt-3 space-y-2">
          <label className="label block" htmlFor={`${ids}-pat`}>
            Personal access token
          </label>
          <div className="flex gap-2">
            <input
              id={`${ids}-pat`}
              type="password"
              autoComplete="off"
              className="input font-mono"
              placeholder="ghp_… or github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <button
              className="btn-primary"
              disabled={mode === "connecting" || !token.trim()}
              onClick={connect}
            >
              {mode === "connecting" && <Spinner label="connecting" />}
              {mode === "connecting" ? "Connecting…" : "Connect"}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setShowConnect(false);
                setToken("");
              }}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            Simplest: a <strong className="text-ink font-medium">classic token</strong>{" "}
            with the <code>repo</code> scope — covers both push and new-repo
            creation.{" "}
            <button
              type="button"
              className="underline hover:text-ink"
              onClick={() =>
                api.openExternal(
                  "https://github.com/settings/tokens/new?scopes=repo&description=ImgPlayGround"
                )
              }
            >
              Create one →
            </button>
            <br />
            <span className="opacity-80">
              Fine-grained tokens work too, but need{" "}
              <code>Administration: Read/Write</code> (create repos) +{" "}
              <code>Contents: Read/Write</code> (push), scoped to the target
              repos.
            </span>
          </p>
        </div>
      )}

      {connected && (
        <div className="border-t border-border pt-3 space-y-3">
          <div>
            <label className="label block mb-1.5" htmlFor={`${ids}-repo`}>
              Sync to
            </label>
            <div className="flex gap-2">
              <select
                id={`${ids}-repo`}
                className="input"
                value={github.remote ?? ""}
                onChange={(e) => pickRepo(e.target.value)}
                disabled={loadingRepos}
              >
                <option value="">Local only (no push)</option>
                {repos.map((r) => (
                  <option key={r.full_name} value={r.clone_url}>
                    {r.full_name}
                    {r.private ? " · private" : " · public"}
                  </option>
                ))}
              </select>
              <button
                className="btn"
                onClick={loadRepos}
                disabled={loadingRepos}
                title="Refresh repo list"
              >
                {loadingRepos ? <Spinner label="loading repos" /> : "↻"}
              </button>
              <button
                className="btn"
                onClick={() => setShowNew((s) => !s)}
                disabled={mode === "creating"}
              >
                {showNew ? "Cancel" : "+ New repo"}
              </button>
            </div>

            {activeRepo && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                <span className="font-mono truncate">
                  {activeRepo.full_name}
                </span>
                <button
                  type="button"
                  className="underline hover:text-ink"
                  onClick={() => api.openExternal(activeRepo.html_url)}
                >
                  Open on GitHub →
                </button>
              </div>
            )}
          </div>

          {showNew && (
            <div className="rounded-md border border-border bg-panel2 p-3 space-y-2">
              <div className="text-xs font-medium">New repository</div>
              <div className="flex gap-2">
                <input
                  className="input font-mono"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="repo-name"
                />
                <label className="btn cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newPrivate}
                    onChange={(e) => setNewPrivate(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[color:var(--accent)]"
                  />
                  Private
                </label>
                <button
                  className="btn-primary"
                  disabled={mode === "creating" || !newName.trim()}
                  onClick={createRepo}
                >
                  {mode === "creating" && <Spinner label="creating" />}
                  {mode === "creating" ? "Creating…" : "Create"}
                </button>
              </div>
              <p className="text-[11px] text-muted">
                Repo is created on your account. If a repo with this name
                already exists, GitHub returns an error — pick a different name.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
