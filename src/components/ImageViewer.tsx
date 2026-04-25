import { useEffect, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import type { GalleryItem, Provider } from "../lib/types";
import { PROVIDERS, PROVIDER_COLORS, PROVIDER_LABELS } from "../lib/types";
import Spinner from "./Spinner";

type Props = {
  items: GalleryItem[];
  index: number;
  thumbs: Record<string, string>;
  ensureThumb: (path: string) => Promise<void>;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onEdit?: (item: GalleryItem) => void;
};

const isKnownProvider = (s: string): s is Provider =>
  (PROVIDERS as readonly string[]).includes(s);

export default function ImageViewer({
  items,
  index,
  thumbs,
  ensureThumb,
  onIndexChange,
  onClose,
  onEdit,
}: Props) {
  const { pushToast } = useStore();
  const [saving, setSaving] = useState(false);

  const current = items[index];

  // Keyboard nav: ← → flip, Esc closes, S triggers save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault();
        onIndexChange(index - 1);
      } else if (e.key === "ArrowRight" && index < items.length - 1) {
        e.preventDefault();
        onIndexChange(index + 1);
      } else if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);

  // Make sure adjacent thumbnails are loaded so prev/next is instant.
  useEffect(() => {
    if (current) ensureThumb(current.path);
    if (items[index - 1]) ensureThumb(items[index - 1].path);
    if (items[index + 1]) ensureThumb(items[index + 1].path);
  }, [index, items, ensureThumb, current]);

  if (!current) return null;

  async function save() {
    if (!current) return;
    const dest = await api.pickDir();
    if (!dest) return;
    setSaving(true);
    try {
      await api.copyImagesTo([current.path], dest);
      const tail = dest.split("/").slice(-2).join("/");
      pushToast("success", `Saved to ${tail}`);
    } catch (e) {
      pushToast("error", `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const hue = isKnownProvider(current.provider)
    ? `var(${PROVIDER_COLORS[current.provider]})`
    : "var(--accent)";
  const b64 = thumbs[current.path];

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={current.prompt || "image viewer"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="viewer-top">
        <button
          type="button"
          className="viewer-icon-btn"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          ✕
        </button>
        <div className="flex gap-2">
          {onEdit && (
            <button
              type="button"
              className="btn"
              onClick={() => onEdit(current)}
              title="Open in pixel-art editor"
            >
              ▦ Edit
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={save}
            disabled={saving}
            title="Save a copy somewhere else (S)"
          >
            {saving ? <Spinner label="saving" /> : "⤓"}
            {saving ? "Saving…" : "Save to…"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => api.openInSystem(current.path)}
            title="Open in system viewer"
          >
            ⤴ Open
          </button>
        </div>
      </div>

      <div
        className="viewer-stage"
        style={{ ["--tc" as string]: hue } as React.CSSProperties}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {b64 ? (
          <img
            src={`data:image/png;base64,${b64}`}
            alt={current.prompt || "generated image"}
            className="viewer-img"
          />
        ) : (
          <div className="text-muted text-sm">Loading…</div>
        )}
      </div>

      {index > 0 && (
        <button
          type="button"
          className="viewer-nav left"
          onClick={() => onIndexChange(index - 1)}
          aria-label="Previous"
          title="Previous (←)"
        >
          ‹
        </button>
      )}
      {index < items.length - 1 && (
        <button
          type="button"
          className="viewer-nav right"
          onClick={() => onIndexChange(index + 1)}
          aria-label="Next"
          title="Next (→)"
        >
          ›
        </button>
      )}

      <div className="viewer-bottom">
        <div className="viewer-prompt" title={current.prompt}>
          {current.prompt || "Untitled"}
        </div>
        <div className="viewer-meta">
          <span
            className="inline-block h-2 w-2 rounded-full mr-1.5 align-middle shrink-0"
            style={{ background: hue }}
          />
          <span className="shrink-0">
            {isKnownProvider(current.provider)
              ? PROVIDER_LABELS[current.provider]
              : current.provider || "unknown"}
          </span>
          {current.created_at && (
            <>
              <span className="mx-2 opacity-60 shrink-0">·</span>
              <span className="tabular-nums shrink-0">
                {current.created_at.slice(0, 10)}
              </span>
            </>
          )}
          <span className="mx-2 opacity-60 shrink-0">·</span>
          <span className="opacity-70 truncate min-w-0 max-w-[40ch]">
            {current.path.split("/").pop() ?? current.path}
          </span>
          <span className="ml-3 opacity-50 tabular-nums shrink-0">
            {index + 1}/{items.length}
          </span>
        </div>
      </div>
    </div>
  );
}
