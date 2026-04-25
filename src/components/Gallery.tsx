import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import type { GalleryItem, Provider } from "../lib/types";
import { PROVIDERS, PROVIDER_COLORS } from "../lib/types";
import Spinner from "./Spinner";
import PageHeader from "./PageHeader";
import ImageViewer from "./ImageViewer";

export default function Gallery() {
  const { pushToast } = useStore();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingTo, setSavingTo] = useState(false);
  const [subfolder, setSubfolder] = useState("");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const all = await api.listGallery();
      setItems(all);
      const head = all.slice(0, 60);
      const entries = await Promise.all(
        head.map(
          async (it) => [it.path, await api.readImageB64(it.path)] as const
        )
      );
      setThumbs(Object.fromEntries(entries));
    } catch (e) {
      pushToast("error", String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const filtered = items.filter((i) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      i.prompt.toLowerCase().includes(q) ||
      i.provider.toLowerCase().includes(q) ||
      i.path.toLowerCase().includes(q)
    );
  });

  const ensureThumb = useCallback(
    async (path: string) => {
      if (thumbs[path]) return;
      const b64 = await api.readImageB64(path);
      setThumbs((t) => ({ ...t, [path]: b64 }));
    },
    [thumbs]
  );

  const isKnownProvider = (s: string): s is Provider =>
    (PROVIDERS as readonly string[]).includes(s);

  function toggleSelected(path: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map((i) => i.path)));
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function saveSelectedTo() {
    if (selected.size === 0) return;
    const dest = await api.pickDir();
    if (!dest) return;
    setSavingTo(true);
    try {
      const sub = subfolder.trim() || undefined;
      const paths = await api.copyImagesTo([...selected], dest, sub);
      const finalDir = sub ? `${dest}/${sub}` : dest;
      pushToast(
        "success",
        `Saved ${paths.length} image${paths.length === 1 ? "" : "s"} to ${finalDir
          .split("/")
          .slice(-2)
          .join("/")}`
      );
      setSubfolder("");
      exitSelect();
    } catch (e) {
      pushToast("error", `Save failed: ${String(e)}`);
    } finally {
      setSavingTo(false);
    }
  }

  return (
    <div className="p-8 pb-24 max-w-[1400px] mx-auto reveal">
      <PageHeader
        num="03"
        title="Gallery"
        subtitle={`${items.length} image${items.length === 1 ? "" : "s"}`}
        right={
          <>
            <input
              id="gallery-filter"
              className="input w-56 text-xs"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {!selectMode ? (
              <>
                <button
                  className="btn"
                  onClick={() => setSelectMode(true)}
                  disabled={items.length === 0}
                >
                  Select
                </button>
                <button className="btn" onClick={refresh} disabled={loading}>
                  {loading && <Spinner label="loading gallery" />}
                  {loading ? "Loading…" : "Refresh"}
                </button>
              </>
            ) : (
              <button className="btn-ghost" onClick={exitSelect}>
                Cancel
              </button>
            )}
          </>
        }
      />

      {filtered.length === 0 && !loading && (
        <div className="text-muted text-sm py-24 text-center font-display italic text-2xl">
          Nothing yet.
          <div className="text-xs not-italic font-sans mt-2">
            Generate something.
          </div>
        </div>
      )}

      <div className="contact-sheet mt-5">
        {filtered.map((it, i) => {
          const hue = isKnownProvider(it.provider)
            ? `var(${PROVIDER_COLORS[it.provider]})`
            : "var(--accent)";
          const isSelected = selected.has(it.path);
          return (
            <button
              key={it.path}
              type="button"
              className={`thumb-wrap thumb-pop text-left ${
                isSelected ? "thumb-selected" : ""
              }`}
              style={
                {
                  animationDelay: `${Math.min(i, 24) * 24}ms`,
                  ["--tc" as string]: hue,
                } as React.CSSProperties
              }
              onClick={() => {
                if (selectMode) toggleSelected(it.path);
                else setViewerIndex(i);
              }}
              onMouseEnter={() => ensureThumb(it.path)}
              onFocus={() => ensureThumb(it.path)}
              aria-pressed={selectMode ? isSelected : undefined}
              aria-label={`${selectMode ? "Select " : "Open "}${
                it.prompt || "image"
              } from ${it.provider}`}
            >
              {thumbs[it.path] ? (
                <img
                  src={`data:image/png;base64,${thumbs[it.path]}`}
                  className="thumb"
                  alt={it.prompt || "generated image"}
                />
              ) : (
                <div className="thumb flex items-center justify-center text-muted text-xs">
                  …
                </div>
              )}
              {selectMode && (
                <span
                  className={`select-check ${isSelected ? "is-on" : ""}`}
                  aria-hidden
                >
                  {isSelected ? "✓" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {viewerIndex !== null && filtered[viewerIndex] && (
        <ImageViewer
          items={filtered}
          index={viewerIndex}
          thumbs={thumbs}
          ensureThumb={ensureThumb}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      {selectMode && (
        <div className="select-toolbar">
          <div className="text-xs font-mono">
            <span className="tabular-nums">{selected.size}</span> selected
          </div>
          <button
            className="btn-ghost text-xs"
            onClick={selectAll}
            disabled={filtered.length === 0}
          >
            Select all ({filtered.length})
          </button>
          <span className="bottombar-sep" />
          <input
            className="input text-xs font-mono w-48"
            placeholder="subfolder (optional)"
            value={subfolder}
            onChange={(e) => setSubfolder(e.target.value)}
            spellCheck={false}
            title="Optional subfolder created under the folder you pick (e.g. tiles/grass)"
          />
          <button
            className="btn-primary"
            onClick={saveSelectedTo}
            disabled={selected.size === 0 || savingTo}
          >
            {savingTo && <Spinner label="saving" />}
            {savingTo ? "Saving…" : `Save to…`}
          </button>
        </div>
      )}
    </div>
  );
}
