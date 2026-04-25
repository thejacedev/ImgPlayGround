#!/usr/bin/env -S uv run --quiet
# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp[cli]>=1.2"]
# ///
"""ImgPlayGround MCP — exposes the local generated-image library to AI clients.

Tools: list_folders, list_pngs, list_png_dimensions, get_png_info, read_png,
copy_png. All paths are relative to the configured output_dir; absolute paths
and `..` escapes are rejected.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.utilities.types import Image

APP_ID = "dev.jace.imgplayground"
CONFIG_FILENAME = "config.json"


def _platform_app_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_ID
    if sys.platform == "win32":
        base = os.environ.get("APPDATA")
        return Path(base) / APP_ID if base else Path.home() / APP_ID
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / APP_ID


def _resolve_output_dir() -> Path:
    env = os.environ.get("IMGPLAYGROUND_OUTPUT_DIR", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    cfg_path = _platform_app_data_dir() / CONFIG_FILENAME
    if cfg_path.is_file():
        try:
            cfg = json.loads(cfg_path.read_text())
            out = (cfg.get("output_dir") or "").strip()
            if out:
                return Path(out).expanduser().resolve()
        except (OSError, json.JSONDecodeError):
            pass
    return _platform_app_data_dir().resolve()


OUTPUT_DIR = _resolve_output_dir()
mcp = FastMCP("imgplayground")


@dataclass
class SafePath:
    abs_: Path
    rel: str


def _safe(rel: str) -> SafePath:
    rel = (rel or "").strip().lstrip("/\\")
    target = (OUTPUT_DIR / rel).resolve() if rel else OUTPUT_DIR
    try:
        target.relative_to(OUTPUT_DIR)
    except ValueError:
        raise ValueError(f"path escapes output_dir: {rel!r}")
    rel_str = "" if target == OUTPUT_DIR else target.relative_to(OUTPUT_DIR).as_posix()
    return SafePath(target, rel_str)


def _is_png(p: Path) -> bool:
    return p.is_file() and p.suffix.lower() == ".png"


_PNG_SIG = b"\x89PNG\r\n\x1a\n"


def _png_dimensions(p: Path) -> tuple[int, int] | None:
    """Parse width/height from a PNG IHDR header without loading pixels."""
    try:
        with p.open("rb") as f:
            head = f.read(24)
    except OSError:
        return None
    if len(head) < 24 or head[:8] != _PNG_SIG or head[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", head[16:24])
    return width, height


@mcp.tool()
def get_output_dir() -> dict:
    """Return the absolute output directory the server is reading from."""
    return {"output_dir": str(OUTPUT_DIR), "exists": OUTPUT_DIR.is_dir()}


@mcp.tool()
def list_folders(parent: str = "") -> list[dict]:
    """List immediate subfolders under `parent` (relative to output_dir).

    Returns name, relative path, and counts of png children and subfolders.
    """
    sp = _safe(parent)
    if not sp.abs_.is_dir():
        return []
    out: list[dict] = []
    for child in sorted(sp.abs_.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        png_count = sum(1 for f in child.iterdir() if _is_png(f))
        sub_count = sum(1 for f in child.iterdir() if f.is_dir() and not f.name.startswith("."))
        out.append({
            "name": child.name,
            "path": child.relative_to(OUTPUT_DIR).as_posix(),
            "png_count": png_count,
            "subfolder_count": sub_count,
        })
    return out


@mcp.tool()
def list_pngs(folder: str = "", recursive: bool = False, limit: int = 200, offset: int = 0) -> dict:
    """List PNG files under `folder` (relative to output_dir).

    Returns paginated entries with name, relative path, size, mtime, and the
    matching `.json` sidecar's prompt/model/provider when present.
    """
    sp = _safe(folder)
    if not sp.abs_.is_dir():
        return {"folder": sp.rel, "total": 0, "limit": limit, "offset": offset, "items": []}
    pngs = sorted(sp.abs_.rglob("*.png") if recursive else sp.abs_.glob("*.png"))
    total = len(pngs)
    sliced = pngs[offset : offset + max(0, limit)]
    items: list[dict] = []
    for p in sliced:
        sidecar = p.with_suffix(".json")
        meta: dict | None = None
        if sidecar.is_file():
            try:
                meta = json.loads(sidecar.read_text())
            except (OSError, json.JSONDecodeError):
                meta = None
        try:
            stat = p.stat()
            size = stat.st_size
            mtime = stat.st_mtime
        except OSError:
            size, mtime = 0, 0.0
        items.append({
            "name": p.name,
            "path": p.relative_to(OUTPUT_DIR).as_posix(),
            "size_bytes": size,
            "mtime": mtime,
            "prompt": (meta or {}).get("prompt"),
            "model": (meta or {}).get("model"),
            "provider": (meta or {}).get("provider"),
        })
    return {"folder": sp.rel, "total": total, "limit": limit, "offset": offset, "items": items}


@mcp.tool()
def list_png_dimensions(folder: str = "", recursive: bool = False, limit: int = 500, offset: int = 0) -> dict:
    """List PNG pixel dimensions (width × height) under `folder`.

    Reads only the 24-byte PNG header per file, so this is fast even on large
    libraries. Returns paginated entries with name, relative path, width, height,
    and aspect ratio. Files that fail header parse are returned with width/height
    null.
    """
    sp = _safe(folder)
    if not sp.abs_.is_dir():
        return {"folder": sp.rel, "total": 0, "limit": limit, "offset": offset, "items": []}
    pngs = sorted(sp.abs_.rglob("*.png") if recursive else sp.abs_.glob("*.png"))
    total = len(pngs)
    sliced = pngs[offset : offset + max(0, limit)]
    items: list[dict] = []
    for p in sliced:
        dims = _png_dimensions(p)
        if dims is None:
            w: int | None = None
            h: int | None = None
            aspect: float | None = None
        else:
            w, h = dims
            aspect = round(w / h, 4) if h else None
        items.append({
            "name": p.name,
            "path": p.relative_to(OUTPUT_DIR).as_posix(),
            "width": w,
            "height": h,
            "aspect": aspect,
        })
    return {"folder": sp.rel, "total": total, "limit": limit, "offset": offset, "items": items}


@mcp.tool()
def get_png_info(path: str) -> dict:
    """Return full sidecar JSON + file stats for a single PNG (relative path)."""
    sp = _safe(path)
    if not sp.abs_.is_file():
        raise ValueError(f"not a file: {sp.rel}")
    sidecar = sp.abs_.with_suffix(".json")
    meta: dict = {}
    if sidecar.is_file():
        try:
            meta = json.loads(sidecar.read_text())
        except (OSError, json.JSONDecodeError):
            meta = {}
    stat = sp.abs_.stat()
    return {
        "path": sp.rel,
        "size_bytes": stat.st_size,
        "mtime": stat.st_mtime,
        "sidecar": meta,
        "has_sidecar": sidecar.is_file(),
    }


@mcp.tool()
def read_png(path: str) -> Image:
    """Read a PNG and return its bytes so vision models can see it.

    Path is relative to output_dir. Refuses files larger than 20 MB.
    """
    sp = _safe(path)
    if not sp.abs_.is_file():
        raise ValueError(f"not a file: {sp.rel}")
    if sp.abs_.suffix.lower() != ".png":
        raise ValueError(f"not a .png: {sp.rel}")
    size = sp.abs_.stat().st_size
    if size > 20 * 1024 * 1024:
        raise ValueError(f"file too large ({size} bytes); cap is 20 MB")
    return Image(data=sp.abs_.read_bytes(), format="png")


@mcp.tool()
def copy_png(src: str, dest: str, overwrite: bool = False, include_sidecar: bool = True) -> dict:
    """Copy a PNG to a new location *within* output_dir.

    `src` and `dest` are both relative to output_dir. Parent folders for
    `dest` are created. If `include_sidecar` and a matching `.json` exists,
    it is copied alongside. Returns the resulting paths.
    """
    s = _safe(src)
    d = _safe(dest)
    if not s.abs_.is_file():
        raise ValueError(f"src not a file: {s.rel}")
    if s.abs_.suffix.lower() != ".png":
        raise ValueError(f"src not a .png: {s.rel}")
    if d.abs_.exists() and not overwrite:
        raise ValueError(f"dest exists (set overwrite=True): {d.rel}")
    d.abs_.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(s.abs_, d.abs_)
    sidecar_dest = None
    if include_sidecar:
        s_side = s.abs_.with_suffix(".json")
        if s_side.is_file():
            d_side = d.abs_.with_suffix(".json")
            shutil.copy2(s_side, d_side)
            sidecar_dest = d_side.relative_to(OUTPUT_DIR).as_posix()
    return {
        "src": s.rel,
        "dest": d.rel,
        "sidecar_dest": sidecar_dest,
        "bytes": d.abs_.stat().st_size,
    }


if __name__ == "__main__":
    mcp.run()
