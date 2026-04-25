import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type {
  Provider,
  GalleryItem,
  GenResult,
  ModelInfo,
  GhRepo,
  GhStatus,
} from "./types";

type GenRequest = {
  provider: Provider;
  prompt: string;
  n: number;
  size: string;
  model?: string;
  seed?: number;
  extra?: unknown;
};

type BulkRequest = {
  prompts: string[];
  providers: Provider[];
  n: number;
  size: string;
  concurrency: number;
};

export const api = {
  setKey: (provider: Provider, value: string) =>
    invoke<void>("set_key", { provider, value }),
  getKeyStatus: () => invoke<[string, boolean][]>("get_key_status"),
  deleteKey: (provider: Provider) => invoke<void>("delete_key", { provider }),

  getOutputDir: () => invoke<string>("get_output_dir"),
  setOutputDir: (path: string) => invoke<void>("set_output_dir", { path }),
  getGitEnabled: () => invoke<boolean>("get_git_enabled"),
  setGitEnabled: (enabled: boolean) =>
    invoke<void>("set_git_enabled", { enabled }),

  generateSingle: (req: GenRequest) =>
    invoke<GenResult>("generate_single", { req }),
  generateBulk: (req: BulkRequest) =>
    invoke<GenResult[]>("generate_bulk", { req }),

  listGallery: () => invoke<GalleryItem[]>("list_gallery"),
  readImageB64: (path: string) => invoke<string>("read_image_b64", { path }),
  copyImagesTo: (paths: string[], dest: string, subfolder?: string) =>
    invoke<string[]>("copy_images_to", { paths, dest, subfolder }),

  listModels: (provider: Provider, forceRefresh = false) =>
    invoke<ModelInfo[]>("list_models", { provider, forceRefresh }),

  githubConnect: (token: string) => invoke<string>("github_connect", { token }),
  githubStatus: () => invoke<GhStatus | null>("github_status"),
  githubDisconnect: () => invoke<void>("github_disconnect"),
  githubListRepos: () => invoke<GhRepo[]>("github_list_repos"),
  githubCreateRepo: (name: string, priv_: boolean) =>
    invoke<GhRepo>("github_create_repo", { name, private: priv_ }),
  githubSetRemote: (cloneUrl: string) =>
    invoke<void>("github_set_remote", { cloneUrl }),
  githubClearRemote: () => invoke<void>("github_clear_remote"),

  pickDir: () =>
    open({ directory: true, multiple: false }) as Promise<string | null>,

  openInSystem: (path: string) => openPath(path),
  openExternal: (url: string) => openUrl(url),
};

export { listen };
