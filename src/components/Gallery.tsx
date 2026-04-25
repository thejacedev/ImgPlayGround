import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../lib/tauri";
import { useStore } from "../lib/store";
import type {
  GalleryDir,
  GalleryItem,
  Provider,
} from "../lib/types";
import { PROVIDERS, PROVIDER_COLORS } from "../lib/types";
import Spinner from "./Spinner";
import PageHeader from "./PageHeader";
import ImageViewer from "./ImageViewer";
import PixelEditor from "./PixelEditor";
import ContextMenu, { type MenuItem } from "./ContextMenu";

const isKnownProvider = (s: string): s is Provider =>
  (PROVIDERS as readonly string[]).includes(s);

const EMPTY_DIR: GalleryDir = {
  folders: [],
  images: [],
  breadcrumb: [{ name: "All", rel_path: "" }],
};

export default function Gallery() {
  const { pushToast } = useStore();
  const [dir, setDir] = useState<GalleryDir>(EMPTY_DIR);
  const [currentPath, setCurrentPath] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingTo, setSavingTo] = useState(false);
  const [subfolder, setSubfolder] = useState("");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [editorTarget, setEditorTarget] = useState<GalleryItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [draggingRel, setDraggingRel] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Context menu + rename state.
  type MenuAt = { x: number; y: number; items: MenuItem[] } | null;
  const [menu, setMenu] = useState<MenuAt>(null);
  const [renaming, setRenaming] = useState<{
    rel: string;
    name: string;
    type: "image" | "folder";
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const refresh = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const next = await api.listGalleryDir(path);
        setDir(next);
        // Pre-load thumbnails for the first chunk of images at this level.
        const head = next.images.slice(0, 60);
        const entries = await Promise.all(
          head.map(
            async (it) =>
              [it.path, await api.readImageB64(it.path)] as const
          )
        );
        setThumbs((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      } catch (e) {
        pushToast("error", String(e));
      } finally {
        setLoading(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    refresh(currentPath);
  }, [currentPath, refresh]);

  const filteredImages = dir.images.filter((i) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      i.prompt.toLowerCase().includes(q) ||
      i.provider.toLowerCase().includes(q) ||
      i.path.toLowerCase().includes(q)
    );
  });

  const filteredFolders = dir.folders.filter((f) =>
    !filter ? true : f.name.toLowerCase().includes(filter.toLowerCase())
  );

  const totalImagesHere = dir.images.length;

  const ensureThumb = useCallback(
    async (path: string) => {
      if (thumbs[path]) return;
      const b64 = await api.readImageB64(path);
      setThumbs((t) => ({ ...t, [path]: b64 }));
    },
    [thumbs]
  );

  function navigate(rel: string) {
    setCurrentPath(rel);
    // Clear selection when changing folders — selecting across folders is
    // confusing and the toolbar count would be misleading.
    if (selectMode) {
      setSelected(new Set());
    }
    setViewerIndex(null);
  }

  function toggleSelected(path: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filteredImages.map((i) => i.path)));
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setFolderBusy(true);
    try {
      await api.createGalleryFolder(currentPath, name);
      pushToast("success", `Created ${name}`);
      setNewFolderName("");
      setCreatingFolder(false);
      await refresh(currentPath);
    } catch (e) {
      pushToast("error", `Couldn't create folder: ${String(e)}`);
    } finally {
      setFolderBusy(false);
    }
  }

  async function moveItem(srcRel: string, destFolderRel: string) {
    if (!srcRel) return;
    if (srcRel === destFolderRel) return;
    // Don't allow dropping a folder into itself or its descendants — the
    // backend rejects this too, but bailing client-side avoids the error toast.
    if (
      destFolderRel.startsWith(srcRel + "/") ||
      destFolderRel === srcRel
    ) {
      return;
    }
    try {
      await api.moveGalleryItem(srcRel, destFolderRel);
      const dest = destFolderRel || "All";
      const tail = srcRel.split("/").pop() ?? srcRel;
      pushToast("info", `Moved ${tail} → ${dest}`);
      await refresh(currentPath);
    } catch (e) {
      pushToast("error", `Move failed: ${String(e)}`);
    }
  }

  async function startRename(rel: string, name: string, type: "image" | "folder") {
    setRenaming({ rel, name, type });
    setRenameDraft(name);
  }

  async function commitRename() {
    if (!renaming) return;
    const name = renameDraft.trim();
    if (!name || name === renaming.name) {
      setRenaming(null);
      return;
    }
    setRenameBusy(true);
    try {
      await api.renameGalleryItem(renaming.rel, name);
      pushToast("info", `Renamed → ${name}`);
      setRenaming(null);
      await refresh(currentPath);
    } catch (e) {
      pushToast("error", `Rename failed: ${String(e)}`);
    } finally {
      setRenameBusy(false);
    }
  }

  async function deleteImage(rel: string, name: string) {
    try {
      await api.deleteGalleryImage(rel);
      pushToast("info", `Deleted ${name}`);
      await refresh(currentPath);
    } catch (e) {
      pushToast("error", `Delete failed: ${String(e)}`);
    }
  }


  async function reorderFolder(
    name: string,
    direction: "up" | "down" | "first" | "last"
  ) {
    try {
      await api.reorderGalleryFolder(currentPath, name, direction);
      await refresh(currentPath);
    } catch (e) {
      pushToast("error", `Reorder failed: ${String(e)}`);
    }
  }

  function folderMenu(
    f: { name: string; rel_path: string; image_count: number },
    index: number,
    total: number,
    pos: { x: number; y: number }
  ) {
    const items: MenuItem[] = [
      {
        kind: "action",
        label: "Open",
        onSelect: () => navigate(f.rel_path),
      },
      { kind: "action", label: "Rename", onSelect: () => startRename(f.rel_path, f.name, "folder") },
      { kind: "divider" },
      {
        kind: "action",
        label: "Move up",
        disabled: index === 0,
        onSelect: () => reorderFolder(f.name, "up"),
      },
      {
        kind: "action",
        label: "Move down",
        disabled: index >= total - 1,
        onSelect: () => reorderFolder(f.name, "down"),
      },
      {
        kind: "action",
        label: "Move to top",
        disabled: index === 0,
        onSelect: () => reorderFolder(f.name, "first"),
      },
      {
        kind: "action",
        label: "Move to bottom",
        disabled: index >= total - 1,
        onSelect: () => reorderFolder(f.name, "last"),
      },
      { kind: "divider" },
      {
        kind: "action",
        label: `Delete folder (${f.image_count})`,
        danger: true,
        onSelect: () => setConfirmDelete(f.rel_path),
      },
    ];
    setMenu({ ...pos, items });
  }

  function imageMenu(
    it: GalleryItem,
    indexInList: number,
    pos: { x: number; y: number }
  ) {
    const filename = it.path.split("/").pop() ?? it.rel_path;
    const items: MenuItem[] = [
      {
        kind: "action",
        label: "Open",
        onSelect: () => setViewerIndex(indexInList),
      },
      {
        kind: "action",
        label: "Reveal in system viewer",
        onSelect: () => api.openInSystem(it.path),
      },
      { kind: "divider" },
      {
        kind: "action",
        label: "Rename",
        onSelect: () => startRename(it.rel_path, filename, "image"),
      },
      {
        kind: "action",
        label: "Save a copy to…",
        onSelect: async () => {
          const dest = await api.pickDir();
          if (!dest) return;
          try {
            await api.copyImagesTo([it.path], dest);
            const tail = dest.split("/").slice(-2).join("/");
            pushToast("success", `Saved to ${tail}`);
          } catch (e) {
            pushToast("error", `Save failed: ${String(e)}`);
          }
        },
      },
      { kind: "divider" },
      {
        kind: "action",
        label: "Delete",
        danger: true,
        onSelect: () => deleteImage(it.rel_path, filename),
      },
    ];
    setMenu({ ...pos, items });
  }

  function dragData(e: React.DragEvent): string | null {
    return e.dataTransfer.getData("application/x-imgplayground") || null;
  }

  function isDragPayload(e: React.DragEvent): boolean {
    return e.dataTransfer.types.includes("application/x-imgplayground");
  }

  async function deleteFolder(rel: string) {
    setDeletingFolder(rel);
    try {
      const removed = await api.deleteGalleryFolder(rel);
      pushToast(
        "info",
        `Deleted ${rel} (${removed} image${removed === 1 ? "" : "s"})`
      );
      setConfirmDelete(null);
      await refresh(currentPath);
    } catch (e) {
      pushToast("error", `Delete failed: ${String(e)}`);
    } finally {
      setDeletingFolder(null);
    }
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
        num="04"
        title="Gallery"
        subtitle={
          totalImagesHere === 0 && dir.folders.length === 0
            ? "Drop images via Generate or Bulk to populate this view."
            : `${totalImagesHere} image${
                totalImagesHere === 1 ? "" : "s"
              } · ${dir.folders.length} subfolder${
                dir.folders.length === 1 ? "" : "s"
              }`
        }
        right={
          <>
            <label htmlFor="gallery-filter" className="sr-only">
              Filter gallery
            </label>
            <input
              id="gallery-filter"
              className="input w-56 text-xs"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            {!selectMode ? (
              <>
                <button
                  className="btn"
                  onClick={() => setSelectMode(true)}
                >
                  Select
                </button>
                <button
                  className="btn"
                  onClick={() => refresh(currentPath)}
                  disabled={loading}
                >
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

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <nav className="breadcrumb" aria-label="Folder path">
          {dir.breadcrumb.map((seg, i) => {
            const last = i === dir.breadcrumb.length - 1;
            const dragKey = `crumb:${seg.rel_path}`;
            const isOver = dragOver === dragKey;
            const isDropTarget =
              !!draggingRel && seg.rel_path !== currentPath;
            return (
              <Fragment key={seg.rel_path || "root"}>
                {i > 0 && <span className="breadcrumb-sep">/</span>}
                {last ? (
                  <span
                    className={`breadcrumb-current ${
                      isOver && isDropTarget ? "drag-over" : ""
                    }`}
                    onDragOver={(e) => {
                      if (!isDragPayload(e) || !isDropTarget) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOver(dragKey);
                    }}
                    onDragLeave={() =>
                      setDragOver((d) => (d === dragKey ? null : d))
                    }
                    onDrop={(e) => {
                      if (!isDropTarget) return;
                      e.preventDefault();
                      setDragOver(null);
                      const raw = dragData(e);
                      if (!raw) return;
                      const { relPath } = JSON.parse(raw);
                      moveItem(relPath, seg.rel_path);
                    }}
                  >
                    {seg.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`breadcrumb-link ${isOver ? "drag-over" : ""}`}
                    onClick={() => navigate(seg.rel_path)}
                    onDragOver={(e) => {
                      if (!isDragPayload(e)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOver(dragKey);
                    }}
                    onDragLeave={() =>
                      setDragOver((d) => (d === dragKey ? null : d))
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(null);
                      const raw = dragData(e);
                      if (!raw) return;
                      const { relPath } = JSON.parse(raw);
                      moveItem(relPath, seg.rel_path);
                    }}
                  >
                    {seg.name}
                  </button>
                )}
              </Fragment>
            );
          })}
        </nav>

        {!creatingFolder && !selectMode && (
          <button
            className="btn-ghost text-xs"
            onClick={() => setCreatingFolder(true)}
            title="Create a new folder here"
          >
            + New folder
          </button>
        )}
      </div>

      {renaming && (
        <form
          className="rename-row"
          onSubmit={(e) => {
            e.preventDefault();
            commitRename();
          }}
        >
          <span className="rename-row-label">
            Rename {renaming.type}
          </span>
          <input
            className="input text-xs font-mono"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(null);
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="btn-primary text-xs"
            disabled={renameBusy || !renameDraft.trim()}
          >
            {renameBusy && <Spinner label="renaming" />}
            {renameBusy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setRenaming(null)}
            disabled={renameBusy}
          >
            Cancel
          </button>
        </form>
      )}

      {creatingFolder && (
        <form
          className="new-folder-row"
          onSubmit={(e) => {
            e.preventDefault();
            createFolder();
          }}
        >
          <input
            className="input text-xs font-mono"
            placeholder="folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setCreatingFolder(false);
                setNewFolderName("");
              }
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="btn-primary text-xs"
            disabled={folderBusy || !newFolderName.trim()}
          >
            {folderBusy && <Spinner label="creating folder" />}
            {folderBusy ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setCreatingFolder(false);
              setNewFolderName("");
            }}
            disabled={folderBusy}
          >
            Cancel
          </button>
        </form>
      )}

      {filteredFolders.length === 0 &&
        filteredImages.length === 0 &&
        !loading && (
          <div className="gallery-empty-folder text-muted">
            <div className="font-display italic text-2xl">
              {currentPath ? "Empty folder." : "Nothing yet."}
            </div>
            <div className="text-xs mt-2">
              {currentPath
                ? "Either nothing landed here, or your filter matches none of it."
                : "Generate something."}
            </div>
          </div>
        )}

      {filteredFolders.length > 0 && (
        <div className="folders-grid">
          {filteredFolders.map((f, i) => {
            const isConfirming = confirmDelete === f.rel_path;
            const isDeleting = deletingFolder === f.rel_path;
            const isDragging = draggingRel === f.rel_path;
            const isOver = dragOver === f.rel_path;
            return (
              <div
                key={f.rel_path}
                className={`folder-tile reveal ${
                  isDragging ? "is-dragging" : ""
                } ${isOver ? "drag-over" : ""}`}
                style={{
                  animationDelay: `${Math.min(i, 12) * 28}ms`,
                }}
                draggable={!isConfirming && !selectMode}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/x-imgplayground",
                    JSON.stringify({ type: "folder", relPath: f.rel_path })
                  );
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingRel(f.rel_path);
                }}
                onDragEnd={() => {
                  setDraggingRel(null);
                  setDragOver(null);
                }}
                onDragOver={(e) => {
                  if (!isDragPayload(e)) return;
                  if (draggingRel === f.rel_path) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOver(f.rel_path);
                }}
                onDragLeave={() =>
                  setDragOver((d) => (d === f.rel_path ? null : d))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const raw = dragData(e);
                  if (!raw) return;
                  const { relPath } = JSON.parse(raw);
                  moveItem(relPath, f.rel_path);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  folderMenu(f, i, filteredFolders.length, {
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                {isConfirming ? (
                  <div className="folder-tile-confirm">
                    <div className="folder-tile-confirm-q">
                      Delete {f.name}?
                    </div>
                    <div className="folder-tile-confirm-sub">
                      {f.image_count} image{f.image_count === 1 ? "" : "s"}{" "}
                      will be lost
                    </div>
                    <div className="folder-tile-confirm-actions">
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => setConfirmDelete(null)}
                        disabled={isDeleting}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-danger text-xs"
                        onClick={() => deleteFolder(f.rel_path)}
                        disabled={isDeleting}
                      >
                        {isDeleting && <Spinner label="deleting" />}
                        {isDeleting ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="folder-tile-main"
                      onClick={() => navigate(f.rel_path)}
                      aria-label={`Open folder ${f.name} (${f.image_count} images)`}
                    >
                      <svg
                        viewBox="0 0 32 32"
                        className="folder-tile-icon"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 9a2 2 0 0 1 2-2h6l3 3h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9z" />
                      </svg>
                      <div className="folder-tile-name">{f.name}</div>
                      <div className="folder-tile-count">
                        {f.image_count}{" "}
                        {f.image_count === 1 ? "image" : "images"}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="folder-tile-delete"
                      onClick={(e) => {
                        // Defensive: even though we're a sibling of
                        // .folder-tile-main, some compositors hit-test
                        // ambiguously through small absolute children.
                        e.stopPropagation();
                        e.preventDefault();
                        setConfirmDelete(f.rel_path);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      aria-label={`Delete folder ${f.name}`}
                      title="Delete folder"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {filteredImages.length > 0 && (
        <div className="contact-sheet">
          {filteredImages.map((it: GalleryItem, i) => {
            const hue = isKnownProvider(it.provider)
              ? `var(${PROVIDER_COLORS[it.provider]})`
              : "var(--accent)";
            const isSelected = selected.has(it.path);
            const isDragging = draggingRel === it.rel_path;
            return (
              <button
                key={it.path}
                type="button"
                className={`thumb-wrap thumb-pop text-left ${
                  isSelected ? "thumb-selected" : ""
                } ${isDragging ? "is-dragging" : ""}`}
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
                draggable={!selectMode}
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/x-imgplayground",
                    JSON.stringify({ type: "image", relPath: it.rel_path })
                  );
                  e.dataTransfer.effectAllowed = "move";
                  setDraggingRel(it.rel_path);
                }}
                onDragEnd={() => setDraggingRel(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  imageMenu(it, i, { x: e.clientX, y: e.clientY });
                }}
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
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}

      {viewerIndex !== null && filteredImages[viewerIndex] && (
        <ImageViewer
          items={filteredImages}
          index={viewerIndex}
          thumbs={thumbs}
          ensureThumb={ensureThumb}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onEdit={(item) => {
            setViewerIndex(null);
            setEditorTarget(item);
          }}
        />
      )}

      {editorTarget && (
        <PixelEditor
          source={editorTarget}
          thumbB64={thumbs[editorTarget.path] ?? null}
          onClose={() => setEditorTarget(null)}
          onSaved={() => refresh(currentPath)}
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
            disabled={filteredImages.length === 0}
          >
            Select all ({filteredImages.length})
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
