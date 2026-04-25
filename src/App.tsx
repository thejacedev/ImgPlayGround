import { useEffect } from "react";
import { useStore } from "./lib/store";
import { api, listen } from "./lib/tauri";
import type { Provider } from "./lib/types";
import Rail from "./components/Rail";
import BottomBar from "./components/BottomBar";
import GeneratePanel from "./components/GeneratePanel";
import BulkPanel from "./components/BulkPanel";
import Gallery from "./components/Gallery";
import KeyManager from "./components/KeyManager";
import Settings from "./components/Settings";
import Toasts from "./components/Toasts";

export default function App() {
  const {
    tab,
    setKeyStatus,
    setOutputDir,
    setGitEnabled,
    setGithub,
    setBulk,
    updateBulkJob,
    pushToast,
  } = useStore();

  useEffect(() => {
    (async () => {
      try {
        const [ks, dir, git, gh] = await Promise.all([
          api.getKeyStatus(),
          api.getOutputDir(),
          api.getGitEnabled(),
          api.githubStatus(),
        ]);
        const obj = Object.fromEntries(ks) as Record<Provider, boolean>;
        setKeyStatus(obj);
        setOutputDir(dir);
        setGitEnabled(git);
        setGithub(gh);
      } catch (e) {
        pushToast("error", `Failed to load app state: ${String(e)}`);
      }
    })();
  }, [setKeyStatus, setOutputDir, setGitEnabled, setGithub, pushToast]);

  // App-level event listeners. They keep running regardless of which tab is
  // mounted, so live progress survives navigation.
  useEffect(() => {
    type Progress = { total: number; completed: number; failed: number };
    type JobDone = { index: number; provider: Provider; success: boolean };
    const unsubProgress = listen<Progress>("bulk-progress", (e) =>
      setBulk({ progress: e.payload })
    );
    const unsubJob = listen<JobDone>("bulk-job-done", (e) => {
      updateBulkJob(e.payload.index, {
        provider: e.payload.provider,
        status: e.payload.success ? "success" : "failed",
      });
    });
    return () => {
      unsubProgress.then((u) => u());
      unsubJob.then((u) => u());
    };
  }, [setBulk, updateBulkJob]);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex flex-1 min-h-0">
        <Rail />
        <main className="flex-1 overflow-auto">
          {tab === "generate" && <GeneratePanel />}
          {tab === "bulk" && <BulkPanel />}
          {tab === "gallery" && <Gallery />}
          {tab === "keys" && <KeyManager />}
          {tab === "settings" && <Settings />}
        </main>
      </div>
      <BottomBar />
      <Toasts />
    </div>
  );
}
