export const PROVIDERS = [
  "openai",
  "google",
  "stability",
  "replicate",
  "fal",
  "bfl",
] as const;

export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: "OpenAI",
  google: "Google Imagen",
  stability: "Stability AI",
  replicate: "Replicate",
  fal: "Fal.ai",
  bfl: "Black Forest Labs",
};

export const PROVIDER_DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-image-2",
  google: "imagen-4.0-generate-001",
  stability: "core",
  replicate: "black-forest-labs/flux-1.1-pro",
  fal: "fal-ai/flux-pro/v1.1",
  bfl: "flux-pro-1.1",
};

// Each provider owns a CSS custom property defined in styles.css.
// Components reference it as `var(${PROVIDER_COLORS[p]})` for a colored dot/chip.
export const PROVIDER_COLORS: Record<Provider, string> = {
  openai: "--p-openai",
  google: "--p-google",
  stability: "--p-stability",
  replicate: "--p-replicate",
  fal: "--p-fal",
  bfl: "--p-bfl",
};

export const SIZES = [
  "1024x1024",
  "1344x768",
  "768x1344",
  "1152x896",
  "896x1152",
] as const;

export type GalleryItem = {
  path: string;
  provider: string;
  prompt: string;
  created_at: string;
};

export type GenResult = {
  provider: string;
  paths: string[];
  error: string | null;
};

export type ModelInfo = {
  id: string;
  label: string;
};

export type GhRepo = {
  name: string;
  full_name: string;
  private: boolean;
  clone_url: string;
  html_url: string;
  default_branch: string;
};

export type GhStatus = {
  username: string;
  remote: string | null;
};
