import { create } from "zustand";
import type {
  Provider,
  ModelInfo,
  GhStatus,
  GenResult,
} from "./types";
import type { JobState } from "../components/BulkGauge";

type Tab = "generate" | "bulk" | "gallery" | "keys" | "settings";

type Toast = {
  id: number;
  kind: "info" | "error" | "success";
  message: string;
};

type BulkProgress = { total: number; completed: number; failed: number };

type GenResultLocal = { path: string; b64: string; provider: Provider };

type State = {
  tab: Tab;
  setTab: (t: Tab) => void;

  keyStatus: Record<Provider, boolean>;
  setKeyStatus: (s: Record<Provider, boolean>) => void;

  outputDir: string;
  setOutputDir: (p: string) => void;

  gitEnabled: boolean;
  setGitEnabled: (b: boolean) => void;

  github: GhStatus | null;
  setGithub: (g: GhStatus | null) => void;

  models: Partial<Record<Provider, ModelInfo[]>>;
  setModels: (p: Provider, list: ModelInfo[]) => void;

  // Bulk run state — persists across tab switches.
  bulkBusy: boolean;
  bulkProgress: BulkProgress;
  bulkJobs: JobState[];
  bulkResults: GenResult[];
  setBulk: (
    patch: Partial<{
      busy: boolean;
      progress: BulkProgress;
      jobs: JobState[];
      results: GenResult[];
    }>
  ) => void;
  updateBulkJob: (index: number, job: JobState) => void;

  // Generate run state — persists across tab switches.
  genBusy: boolean;
  genResults: GenResultLocal[];
  setGen: (
    patch: Partial<{ busy: boolean; results: GenResultLocal[] }>
  ) => void;

  toasts: Toast[];
  pushToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
};

let toastId = 0;

export const useStore = create<State>((set) => ({
  tab: "generate",
  setTab: (tab) => set({ tab }),

  keyStatus: {
    openai: false,
    google: false,
    stability: false,
    replicate: false,
    fal: false,
    bfl: false,
  },
  setKeyStatus: (keyStatus) => set({ keyStatus }),

  outputDir: "",
  setOutputDir: (outputDir) => set({ outputDir }),

  gitEnabled: false,
  setGitEnabled: (gitEnabled) => set({ gitEnabled }),

  github: null,
  setGithub: (github) => set({ github }),

  models: {},
  setModels: (p, list) =>
    set((s) => ({ models: { ...s.models, [p]: list } })),

  bulkBusy: false,
  bulkProgress: { total: 0, completed: 0, failed: 0 },
  bulkJobs: [],
  bulkResults: [],
  setBulk: (patch) =>
    set((s) => ({
      bulkBusy: patch.busy ?? s.bulkBusy,
      bulkProgress: patch.progress ?? s.bulkProgress,
      bulkJobs: patch.jobs ?? s.bulkJobs,
      bulkResults: patch.results ?? s.bulkResults,
    })),
  updateBulkJob: (index, job) =>
    set((s) => ({
      bulkJobs: s.bulkJobs.map((j, i) => (i === index ? job : j)),
    })),

  genBusy: false,
  genResults: [],
  setGen: (patch) =>
    set((s) => ({
      genBusy: patch.busy ?? s.genBusy,
      genResults: patch.results ?? s.genResults,
    })),

  toasts: [],
  pushToast: (kind, message) =>
    set((s) => ({
      toasts: [...s.toasts, { id: ++toastId, kind, message }],
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
