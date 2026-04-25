import { useEffect, useRef, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import type { GalleryItem, Provider } from "../lib/types";
import { PROVIDERS, PROVIDER_COLORS, PROVIDER_LABELS } from "../lib/types";
import Spinner from "./Spinner";

type Props = {
  source: GalleryItem;
  thumbB64: string | null;
  onClose: () => void;
  onSaved: () => void;
};

const isKnownProvider = (s: string): s is Provider =>
  (PROVIDERS as readonly string[]).includes(s);

const PRESETS = [16, 24, 32, 48, 64, 96, 128, 256] as const;

export default function PixelEditor({ source, thumbB64, onClose, onSaved }: Props) {
  const { pushToast } = useStore();
  const [size, setSize] = useState(64);
  const [upscale, setUpscale] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [b64, setB64] = useState<string | null>(thumbB64);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Load source bytes if we don't already have them.
  useEffect(() => {
    if (b64) return;
    let cancelled = false;
    api
      .readImageB64(source.path)
      .then((v) => {
        if (!cancelled) setB64(v);
      })
      .catch((e) => {
        if (!cancelled) pushToast("error", `Couldn't load image: ${String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [source.path, b64, pushToast]);

  // Decode the source into an Image element once, reuse for every render.
  useEffect(() => {
    if (!b64) return;
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      render();
    };
    img.onerror = () => pushToast("error", "Couldn't decode image");
    img.src = `data:image/png;base64,${b64}`;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b64]);

  // Re-render whenever the user changes a setting.
  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, upscale, showOriginal]);

  function render() {
    const canvas = previewRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    const maxDim = Math.max(sw, sh);
    const scale = size / maxDim;
    const lowW = Math.max(1, Math.round(sw * scale));
    const lowH = Math.max(1, Math.round(sh * scale));

    if (showOriginal) {
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, sw, sh);
      ctx.drawImage(img, 0, 0, sw, sh);
      return;
    }

    // Two-pass nearest-neighbor: down to lowW×lowH, then optionally up to
    // the source dimensions. `imageSmoothingEnabled = false` is the entire
    // pixelation algorithm — no AI, no quantization, just sampling.
    const tmp = document.createElement("canvas");
    tmp.width = lowW;
    tmp.height = lowH;
    const tmpCtx = tmp.getContext("2d");
    if (!tmpCtx) return;
    tmpCtx.imageSmoothingEnabled = false;
    tmpCtx.drawImage(img, 0, 0, lowW, lowH);

    const outW = upscale ? sw : lowW;
    const outH = upscale ? sh : lowH;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, outW, outH);
    ctx.drawImage(tmp, 0, 0, outW, outH);
  }

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, upscale]);

  async function save() {
    setSaving(true);
    try {
      await api.pixelateImage(source.rel_path, size, upscale);
      pushToast("success", `Saved · ${size}px`);
      onSaved();
      onClose();
    } catch (e) {
      pushToast("error", `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const hue = isKnownProvider(source.provider)
    ? `var(${PROVIDER_COLORS[source.provider]})`
    : "var(--accent)";
  const filename = source.path.split("/").pop() ?? source.rel_path;
  const naturalDims =
    imageRef.current?.naturalWidth && imageRef.current?.naturalHeight
      ? `${imageRef.current.naturalWidth}×${imageRef.current.naturalHeight}`
      : "—";
  const lowDims = (() => {
    const img = imageRef.current;
    if (!img) return "—";
    const max = Math.max(img.naturalWidth, img.naturalHeight);
    const s = size / max;
    const w = Math.max(1, Math.round(img.naturalWidth * s));
    const h = Math.max(1, Math.round(img.naturalHeight * s));
    return `${w}×${h}`;
  })();

  return (
    <div
      className="editor"
      role="dialog"
      aria-modal="true"
      aria-label="Pixel art editor"
      style={{ ["--tc" as string]: hue } as React.CSSProperties}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="editor-top">
        <button
          type="button"
          className="viewer-icon-btn"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          ✕
        </button>
        <div className="editor-title-stack">
          <div className="editor-kicker">Pixel Art Editor</div>
          <div className="editor-title">{filename}</div>
        </div>
        <div className="editor-top-spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => setShowOriginal((v) => !v)}
          aria-pressed={showOriginal}
          title="Toggle showing the source image instead of the preview"
        >
          {showOriginal ? "Showing original" : "Show original"}
        </button>
        <button
          type="button"
          className={`btn-primary ${saving ? "is-busy" : ""}`}
          onClick={save}
          disabled={saving}
        >
          {saving && <Spinner label="saving" />}
          {saving ? "Saving…" : `Save · ${size}px`}
        </button>
      </div>

      <div className="editor-stage" ref={containerRef}>
        <div className="editor-canvas-wrap">
          <canvas ref={previewRef} className="editor-canvas" />
        </div>
        <div className="editor-stage-meta">
          <span>{showOriginal ? "Source" : "Preview"}</span>
          <span className="opacity-60 mx-1">·</span>
          <span className="tabular-nums">
            {showOriginal ? naturalDims : upscale ? naturalDims : lowDims}
          </span>
          <span className="opacity-60 mx-1">·</span>
          <span>
            grid {lowDims}
          </span>
        </div>
      </div>

      <aside className="editor-panel">
        <div className="editor-source-info">
          <div className="editor-source-row">
            <span
              className="inline-block h-2 w-2 rounded-full mr-1.5 align-middle"
              style={{ background: hue }}
            />
            {isKnownProvider(source.provider)
              ? PROVIDER_LABELS[source.provider]
              : source.provider || "unknown"}
          </div>
          <div className="editor-source-row text-muted">
            <span>{naturalDims}</span>
          </div>
        </div>

        <div className="editor-section">
          <label className="label flex items-center justify-between" htmlFor="pixel-size">
            <span>Pixel grid (longest edge)</span>
            <span className="font-mono normal-case tracking-normal text-ink tabular-nums">
              {size}px
            </span>
          </label>
          <input
            id="pixel-size"
            type="range"
            min={4}
            max={512}
            value={size}
            onChange={(e) => setSize(parseInt(e.target.value) || 4)}
            className="editor-slider"
            aria-valuemin={4}
            aria-valuemax={512}
            aria-valuenow={size}
          />
          <div className="editor-presets">
            {PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                className={`editor-preset ${size === s ? "is-on" : ""}`}
                onClick={() => setSize(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="editor-section">
          <div className="label mb-2">Output size</div>
          <label className="editor-radio">
            <input
              type="radio"
              name="upscale"
              checked={upscale}
              onChange={() => setUpscale(true)}
            />
            <div>
              <div className="text-sm">Blocky</div>
              <div className="text-[11px] text-muted">
                Upscale back to the original {naturalDims}, nearest-neighbor.
                Same canvas size, chunky pixels.
              </div>
            </div>
          </label>
          <label className="editor-radio">
            <input
              type="radio"
              name="upscale"
              checked={!upscale}
              onChange={() => setUpscale(false)}
            />
            <div>
              <div className="text-sm">Tiny</div>
              <div className="text-[11px] text-muted">
                Save the literal {lowDims} small image. For sprite atlases
                / true low-res assets.
              </div>
            </div>
          </label>
        </div>

        <div className="editor-section editor-hint">
          <div className="text-[11px] text-muted leading-relaxed">
            Algorithm: nearest-neighbor sampling, two passes. No AI, no color
            quantization — just deterministic pixel scaling. Saves to the
            same folder as{" "}
            <code className="font-mono">{filename}</code> with{" "}
            <code className="font-mono">-pixel-{size}.png</code> appended.
          </div>
        </div>
      </aside>
    </div>
  );
}
