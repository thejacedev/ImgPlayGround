mod config;
mod git;
mod github;
mod keys;
mod pixelate;
mod providers;
mod storage;

use base64::Engine;
use github::{GitHub, Repo as GhRepo};
use providers::{GenParams, ModelInfo, Provider};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

const GITHUB_KEY_NAME: &str = "github";

pub struct AppState {
    pub app_data: PathBuf,
    pub output_dir: Mutex<PathBuf>,
    pub git_enabled: Mutex<bool>,
    pub git_remote: Mutex<Option<String>>,
    pub github_username: Mutex<Option<String>>,
    pub model_cache: Mutex<HashMap<Provider, Vec<ModelInfo>>>,
    /// Set to a fresh AtomicBool when a bulk run starts. cancel_bulk flips
    /// it; each pending job in `generate_bulk` checks before running.
    pub bulk_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl AppState {
    fn persist(&self) -> Result<(), String> {
        let cfg = config::Config {
            output_dir: Some(self.output_dir.lock().unwrap().to_string_lossy().to_string()),
            git_enabled: *self.git_enabled.lock().unwrap(),
            git_remote: self.git_remote.lock().unwrap().clone(),
        };
        config::save(&self.app_data, &cfg).map_err(|e| e.to_string())
    }
}

// ─── Key commands ──────────────────────────────────────────────────────────

#[tauri::command]
fn set_key(provider: String, value: String) -> Result<(), String> {
    keys::set_key(&provider, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_key_status() -> Result<Vec<(String, bool)>, String> {
    let providers = [
        Provider::OpenAI,
        Provider::Google,
        Provider::Stability,
        Provider::Replicate,
        Provider::Fal,
        Provider::Bfl,
    ];
    let mut out = Vec::new();
    for p in providers {
        let has = keys::get_key(p.as_str())
            .map_err(|e| e.to_string())?
            .is_some();
        out.push((p.as_str().to_string(), has));
    }
    Ok(out)
}

#[tauri::command]
fn delete_key(provider: String, state: State<'_, AppState>) -> Result<(), String> {
    keys::delete_key(&provider).map_err(|e| e.to_string())?;
    if let Some(p) = Provider::from_str(&provider) {
        state.model_cache.lock().unwrap().remove(&p);
    }
    Ok(())
}

// ─── Settings commands ─────────────────────────────────────────────────────

#[tauri::command]
fn get_output_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state
        .output_dir
        .lock()
        .unwrap()
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn set_output_dir(path: String, state: State<'_, AppState>) -> Result<(), String> {
    *state.output_dir.lock().unwrap() = PathBuf::from(path);
    state.persist()
}

#[tauri::command]
fn get_git_enabled(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(*state.git_enabled.lock().unwrap())
}

#[tauri::command]
fn set_git_enabled(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    *state.git_enabled.lock().unwrap() = enabled;
    state.persist()
}

// ─── Generation commands ───────────────────────────────────────────────────

#[derive(Deserialize, Clone)]
struct GenRequest {
    provider: String,
    prompt: String,
    n: u32,
    size: String,
    model: Option<String>,
    seed: Option<u64>,
    extra: Option<serde_json::Value>,
}

#[derive(Serialize, Clone, Debug)]
struct GenResult {
    provider: String,
    paths: Vec<String>,
    error: Option<String>,
}

async fn run_one(
    provider_str: &str,
    prompt: &str,
    n: u32,
    size: &str,
    model: Option<String>,
    seed: Option<u64>,
    extra: Option<serde_json::Value>,
    out_root: &Path,
    app: &AppHandle,
) -> Result<Vec<String>, String> {
    let provider = Provider::from_str(provider_str)
        .ok_or_else(|| format!("unknown provider: {}", provider_str))?;
    let key = keys::get_key(provider.as_str())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("no API key for {}", provider_str))?;

    // Pull folder + filename overrides out of the prompt. Format:
    //   `<prompt>;<folder/path>:<name.ext>` (both suffixes optional).
    // The cleaned prompt is what gets sent to the provider — neither suffix
    // ends up in the API call.
    let (clean_prompt, folder_override, name_override) =
        storage::parse_prompt_suffixes(prompt);

    let params = GenParams {
        prompt: clean_prompt.clone(),
        n: n.max(1),
        size: size.to_string(),
        model: model.clone(),
        seed,
        extra: extra.clone(),
    };
    let outputs = providers::generate(provider, &key, &params)
        .await
        .map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    for (idx, o) in outputs.into_iter().enumerate() {
        let meta = storage::ImageMeta {
            provider: provider.as_str().to_string(),
            model: o.model.clone(),
            prompt: clean_prompt.clone(),
            size: size.to_string(),
            seed: o.seed.or(seed),
            created_at: chrono::Local::now().to_rfc3339(),
            params: serde_json::json!({
                "size": size,
                "n": n,
                "model": model,
                "extra": extra,
            }),
        };
        // For n > 1 with a custom name, suffix `-2`, `-3`, … so they don't
        // collide. The first one keeps the bare name.
        let name_for_this = name_override.as_ref().map(|name| {
            if idx == 0 {
                name.clone()
            } else {
                let (stem, ext) = name.rsplit_once('.').unwrap_or((name.as_str(), ""));
                if ext.is_empty() {
                    format!("{}-{}", stem, idx + 1)
                } else {
                    format!("{}-{}.{}", stem, idx + 1, ext)
                }
            }
        });
        let p = storage::save_image(
            out_root,
            provider.as_str(),
            &o.bytes,
            &o.mime,
            &meta,
            name_for_this.as_deref(),
            folder_override.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;
        paths.push(p.to_string_lossy().to_string());
        let _ = app.emit(
            "image-saved",
            serde_json::json!({
                "path": p.to_string_lossy(),
                "provider": provider.as_str(),
                "prompt": clean_prompt,
            }),
        );
    }
    Ok(paths)
}

/// Commits in the output dir and — if a GitHub remote is set and we have a
/// token — pushes to `main`. Non-fatal: push failure becomes a warning toast,
/// the commit is already safe locally.
async fn commit_and_maybe_push(
    state: &AppState,
    out_dir: &Path,
    msg: &str,
    app: &AppHandle,
) -> Result<(), String> {
    git::ensure_init(out_dir).await.map_err(|e| e.to_string())?;
    git::commit_all(out_dir, msg).await.map_err(|e| e.to_string())?;

    let remote = state.git_remote.lock().unwrap().clone();
    if let Some(clone_url) = remote {
        if let Ok(Some(token)) = keys::get_key(GITHUB_KEY_NAME) {
            let tokenized = github::tokenized_push_url(&clone_url, &token);
            if let Err(e) = git::push_to(out_dir, &tokenized).await {
                let _ = app.emit(
                    "git-push-failed",
                    serde_json::json!({ "error": e.to_string() }),
                );
                return Err(format!("push failed: {}", e));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn generate_single(
    req: GenRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GenResult, String> {
    let out_dir = state.output_dir.lock().unwrap().clone();
    let git_enabled = *state.git_enabled.lock().unwrap();

    let res = run_one(
        &req.provider,
        &req.prompt,
        req.n,
        &req.size,
        req.model.clone(),
        req.seed,
        req.extra.clone(),
        &out_dir,
        &app,
    )
    .await;

    let result = match res {
        Ok(paths) => GenResult {
            provider: req.provider.clone(),
            paths,
            error: None,
        },
        Err(e) => GenResult {
            provider: req.provider.clone(),
            paths: vec![],
            error: Some(e),
        },
    };

    if git_enabled && result.error.is_none() && !result.paths.is_empty() {
        let msg = format!("gen: {} | {}", req.provider, truncate(&req.prompt, 60));
        let _ = commit_and_maybe_push(&state, &out_dir, &msg, &app).await;
    }

    Ok(result)
}

#[derive(Deserialize)]
struct BulkRequest {
    prompts: Vec<String>,
    providers: Vec<String>,
    n: u32,
    size: String,
    concurrency: u32,
}

#[derive(Serialize, Clone)]
struct BulkProgress {
    total: usize,
    completed: usize,
    failed: usize,
}

#[tauri::command]
async fn generate_bulk(
    req: BulkRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<GenResult>, String> {
    use futures::stream::{self, StreamExt};

    let jobs: Vec<(String, String)> = req
        .providers
        .iter()
        .flat_map(|p| req.prompts.iter().map(move |pr| (p.clone(), pr.clone())))
        .collect();

    let total = jobs.len();
    let results = Arc::new(tokio::sync::Mutex::new(Vec::<GenResult>::new()));
    let completed = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let failed = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let out_dir = state.output_dir.lock().unwrap().clone();
    let git_enabled = *state.git_enabled.lock().unwrap();
    let concurrency = req.concurrency.max(1) as usize;
    let size = req.size.clone();
    let n = req.n;

    let prompts_len = req.prompts.len();
    let providers_len = req.providers.len();

    // Install a fresh cancel flag for this batch. Any prior flag is replaced.
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut lock = state.bulk_cancel.lock().unwrap();
        *lock = Some(cancel_flag.clone());
    }

    stream::iter(jobs.into_iter().enumerate().map(|(idx, (provider, prompt))| {
        let app = app.clone();
        let results = results.clone();
        let completed = completed.clone();
        let failed = failed.clone();
        let out_dir = out_dir.clone();
        let size = size.clone();
        let cancel = cancel_flag.clone();
        async move {
            // Cancel was requested before this job got dispatched — short-circuit.
            if cancel.load(Ordering::Relaxed) {
                failed.fetch_add(1, Ordering::Relaxed);
                results.lock().await.push(GenResult {
                    provider: provider.clone(),
                    paths: vec![],
                    error: Some("cancelled".to_string()),
                });
                let _ = app.emit(
                    "bulk-job-done",
                    serde_json::json!({
                        "index": idx,
                        "provider": provider,
                        "success": false,
                        "cancelled": true,
                    }),
                );
                let _ = app.emit(
                    "bulk-progress",
                    BulkProgress {
                        total,
                        completed: completed.load(Ordering::Relaxed),
                        failed: failed.load(Ordering::Relaxed),
                    },
                );
                return;
            }

            let res =
                run_one(&provider, &prompt, n, &size, None, None, None, &out_dir, &app)
                    .await;
            let success = res.is_ok();
            let r = match res {
                Ok(paths) => {
                    completed.fetch_add(1, Ordering::Relaxed);
                    GenResult {
                        provider: provider.clone(),
                        paths,
                        error: None,
                    }
                }
                Err(e) => {
                    failed.fetch_add(1, Ordering::Relaxed);
                    GenResult {
                        provider: provider.clone(),
                        paths: vec![],
                        error: Some(e),
                    }
                }
            };
            results.lock().await.push(r);
            let _ = app.emit(
                "bulk-job-done",
                serde_json::json!({
                    "index": idx,
                    "provider": provider,
                    "success": success,
                    "cancelled": false,
                }),
            );
            let _ = app.emit(
                "bulk-progress",
                BulkProgress {
                    total,
                    completed: completed.load(Ordering::Relaxed),
                    failed: failed.load(Ordering::Relaxed),
                },
            );
        }
    }))
    .buffer_unordered(concurrency)
    .collect::<Vec<_>>()
    .await;

    // Clear the cancel flag now that the batch is done.
    {
        let mut lock = state.bulk_cancel.lock().unwrap();
        *lock = None;
    }

    if git_enabled {
        let msg = format!(
            "batch: {} prompts × {} providers",
            prompts_len, providers_len
        );
        let _ = commit_and_maybe_push(&state, &out_dir, &msg, &app).await;
    }

    let final_results = std::mem::take(&mut *results.lock().await);
    Ok(final_results)
}

// ─── Gallery ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GalleryItem {
    /// Absolute path on disk.
    path: String,
    /// Path relative to `output_dir`, always with `/` separators.
    rel_path: String,
    provider: String,
    prompt: String,
    created_at: String,
}

fn rel_under(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

#[derive(Serialize)]
struct GalleryFolder {
    name: String,
    /// Path relative to output_dir, with `/` separators.
    rel_path: String,
    image_count: u32,
}

#[derive(Serialize)]
struct GalleryDir {
    folders: Vec<GalleryFolder>,
    images: Vec<GalleryItem>,
    /// Path segments back to the root, including a leading "All" entry.
    breadcrumb: Vec<BreadcrumbSegment>,
}

#[derive(Serialize)]
struct BreadcrumbSegment {
    name: String,
    rel_path: String,
}

async fn count_images_recursive(dir: &Path) -> anyhow::Result<u32> {
    let mut count = 0u32;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&d).await?;
        while let Some(entry) = rd.next_entry().await? {
            let path = entry.path();
            let ft = entry.file_type().await?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            if ft.is_dir() {
                stack.push(path);
            } else if let Some(ext) = path.extension().and_then(|x| x.to_str()) {
                if matches!(ext, "png" | "jpg" | "jpeg" | "webp") {
                    count += 1;
                }
            }
        }
    }
    Ok(count)
}

#[tauri::command]
async fn list_gallery_dir(
    rel: Option<String>,
    state: State<'_, AppState>,
) -> Result<GalleryDir, String> {
    let root = state.output_dir.lock().unwrap().clone();
    let rel = rel.unwrap_or_default();
    if rel.contains("..") || rel.starts_with('/') || rel.starts_with('\\') {
        return Err("invalid path".into());
    }
    let dir = if rel.is_empty() {
        root.clone()
    } else {
        root.join(rel.replace('\\', "/"))
    };

    let mut folders = Vec::new();
    let mut images = Vec::new();

    if dir.exists() {
        let mut rd = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| e.to_string())?;
        while let Some(entry) = rd.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            let ft = entry.file_type().await.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            if ft.is_dir() {
                let rel_path = if rel.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", rel, name)
                };
                let image_count = count_images_recursive(&path).await.unwrap_or(0);
                folders.push(GalleryFolder {
                    name,
                    rel_path,
                    image_count,
                });
            } else if let Some(ext) = path.extension().and_then(|x| x.to_str()) {
                if matches!(ext, "png" | "jpg" | "jpeg" | "webp") {
                    let meta_path = path.with_extension(format!("{}.json", ext));
                    let meta: Option<serde_json::Value> = if meta_path.exists() {
                        tokio::fs::read_to_string(&meta_path)
                            .await
                            .ok()
                            .and_then(|s| serde_json::from_str(&s).ok())
                    } else {
                        None
                    };
                    images.push(GalleryItem {
                        path: path.to_string_lossy().to_string(),
                        rel_path: rel_under(&root, &path),
                        provider: meta
                            .as_ref()
                            .and_then(|m| m.get("provider"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        prompt: meta
                            .as_ref()
                            .and_then(|m| m.get("prompt"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        created_at: meta
                            .as_ref()
                            .and_then(|m| m.get("created_at"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    });
                }
            }
        }
    }

    // Apply per-folder manual order, falling back to alphabetical for any
    // folders not present in the saved list (newly created, renamed, etc.).
    let saved_order = read_order(&dir).await;
    folders.sort_by(|a, b| {
        let pa = saved_order.iter().position(|n| n == &a.name);
        let pb = saved_order.iter().position(|n| n == &b.name);
        match (pa, pb) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    images.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let mut breadcrumb = vec![BreadcrumbSegment {
        name: "All".to_string(),
        rel_path: String::new(),
    }];
    if !rel.is_empty() {
        let mut accum = String::new();
        for seg in rel.split('/') {
            if seg.is_empty() {
                continue;
            }
            if !accum.is_empty() {
                accum.push('/');
            }
            accum.push_str(seg);
            breadcrumb.push(BreadcrumbSegment {
                name: seg.to_string(),
                rel_path: accum.clone(),
            });
        }
    }

    Ok(GalleryDir {
        folders,
        images,
        breadcrumb,
    })
}

#[tauri::command]
async fn list_gallery(state: State<'_, AppState>) -> Result<Vec<GalleryItem>, String> {
    // Walk the entire output dir (not just `generated/`) so user-defined
    // folders from the `;path` suffix show up too. Skip dotted folders and
    // anything that looks like git internals to keep the scan tight.
    let root = state.output_dir.lock().unwrap().clone();
    let mut items = Vec::new();
    if !root.exists() {
        return Ok(items);
    }
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
        while let Some(entry) = rd.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            let ft = entry.file_type().await.map_err(|e| e.to_string())?;
            if ft.is_dir() {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                if name.starts_with('.') || name == "node_modules" {
                    continue;
                }
                stack.push(path);
            } else if let Some(ext) = path.extension().and_then(|x| x.to_str()) {
                if matches!(ext, "png" | "jpg" | "jpeg" | "webp") {
                    let meta_path = path.with_extension(format!("{}.json", ext));
                    let meta: Option<serde_json::Value> = if meta_path.exists() {
                        tokio::fs::read_to_string(&meta_path)
                            .await
                            .ok()
                            .and_then(|s| serde_json::from_str(&s).ok())
                    } else {
                        None
                    };
                    items.push(GalleryItem {
                        path: path.to_string_lossy().to_string(),
                        rel_path: rel_under(&root, &path),
                        provider: meta
                            .as_ref()
                            .and_then(|m| m.get("provider"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        prompt: meta
                            .as_ref()
                            .and_then(|m| m.get("prompt"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        created_at: meta
                            .as_ref()
                            .and_then(|m| m.get("created_at"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    });
                }
            }
        }
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(items)
}

fn sanitize_segment(s: &str) -> String {
    s.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
        .map(|c| if c == ' ' { '-' } else { c })
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

/// Per-folder manual sort order. Stored as `.imgplayground-order.json` —
/// hidden file (skipped by the gallery walker) containing a JSON array of
/// child folder names in display order. Missing entries fall back to
/// alphabetical at the tail.
const ORDER_FILE: &str = ".imgplayground-order.json";

async fn read_order(dir: &Path) -> Vec<String> {
    let path = dir.join(ORDER_FILE);
    match tokio::fs::read_to_string(&path).await {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

async fn write_order(dir: &Path, order: &[String]) -> anyhow::Result<()> {
    let path = dir.join(ORDER_FILE);
    let json = serde_json::to_vec_pretty(order)?;
    tokio::fs::write(&path, json).await?;
    Ok(())
}

#[tauri::command]
async fn reorder_gallery_folder(
    parent: Option<String>,
    name: String,
    direction: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let parent = parent.unwrap_or_default();
    if parent.contains("..") || parent.starts_with('/') || parent.starts_with('\\') {
        return Err("invalid parent".into());
    }
    let root = state.output_dir.lock().unwrap().clone();
    let parent_dir = if parent.is_empty() {
        root
    } else {
        state
            .output_dir
            .lock()
            .unwrap()
            .join(parent.replace('\\', "/"))
    };

    // Discover the actual child folders right now, then weave the saved order
    // in front of any unknown names so the result reflects reality.
    let mut alpha: Vec<String> = Vec::new();
    let mut rd = tokio::fs::read_dir(&parent_dir)
        .await
        .map_err(|e| e.to_string())?;
    while let Some(entry) = rd.next_entry().await.map_err(|e| e.to_string())? {
        let ft = entry.file_type().await.map_err(|e| e.to_string())?;
        let n = entry.file_name().to_string_lossy().to_string();
        if n.starts_with('.') || n == "node_modules" {
            continue;
        }
        if ft.is_dir() {
            alpha.push(n);
        }
    }
    alpha.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    let saved = read_order(&parent_dir).await;
    let mut current: Vec<String> = saved
        .iter()
        .filter(|n| alpha.contains(n))
        .cloned()
        .collect();
    for n in &alpha {
        if !current.contains(n) {
            current.push(n.clone());
        }
    }

    let idx = current
        .iter()
        .position(|n| n == &name)
        .ok_or_else(|| format!("\"{}\" not in this folder", name))?;
    match direction.as_str() {
        "up" if idx > 0 => current.swap(idx, idx - 1),
        "down" if idx + 1 < current.len() => current.swap(idx, idx + 1),
        "first" => {
            let v = current.remove(idx);
            current.insert(0, v);
        }
        "last" => {
            let v = current.remove(idx);
            current.push(v);
        }
        _ => {} // already at edge — noop
    }

    write_order(&parent_dir, &current)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Rename a file or folder in place. For images, the matching .json sidecar
/// is renamed alongside. If `new_name` for a file omits an extension, the
/// original extension is preserved automatically.
#[tauri::command]
async fn rename_gallery_item(
    rel: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if rel.trim().is_empty()
        || rel.contains("..")
        || rel.starts_with('/')
        || rel.starts_with('\\')
    {
        return Err("invalid path".into());
    }
    let safe = sanitize_segment(&new_name);
    if safe.is_empty() {
        return Err("invalid new name".into());
    }

    let root = state.output_dir.lock().unwrap().clone();
    let src = root.join(rel.replace('\\', "/"));
    let src_canon = tokio::fs::canonicalize(&src)
        .await
        .map_err(|e| format!("source not found: {}", e))?;
    let root_canon = tokio::fs::canonicalize(&root)
        .await
        .map_err(|e| e.to_string())?;
    if !src_canon.starts_with(&root_canon) || src_canon == root_canon {
        return Err("path escapes output_dir".into());
    }
    let parent = src_canon
        .parent()
        .ok_or("no parent directory")?
        .to_path_buf();
    let was_dir = src_canon.is_dir();

    // Files: re-attach the original extension if the user didn't supply one,
    // so a rename like "moss-tile-v2" doesn't quietly turn .png into nothing.
    let final_name = if was_dir {
        safe.clone()
    } else {
        let supplied_has_ext = std::path::Path::new(&safe)
            .extension()
            .map(|e| {
                matches!(
                    e.to_str().map(|s| s.to_lowercase()).as_deref(),
                    Some("png") | Some("jpg") | Some("jpeg") | Some("webp")
                )
            })
            .unwrap_or(false);
        if supplied_has_ext {
            safe.clone()
        } else if let Some(orig_ext) =
            src_canon.extension().and_then(|e| e.to_str())
        {
            format!("{}.{}", safe, orig_ext)
        } else {
            safe.clone()
        }
    };

    let target = parent.join(&final_name);
    if target == src_canon {
        return Ok(rel);
    }
    if target.exists() {
        return Err(format!("\"{}\" already exists", final_name));
    }

    let src_filename = src_canon
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("bad source name")?
        .to_string();
    let src_sidecar = parent.join(format!("{}.json", src_filename));
    let target_sidecar = parent.join(format!("{}.json", final_name));
    let move_sidecar = !was_dir && src_sidecar.exists();

    tokio::fs::rename(&src_canon, &target)
        .await
        .map_err(|e| e.to_string())?;
    if move_sidecar {
        let _ = tokio::fs::rename(&src_sidecar, &target_sidecar).await;
    }

    Ok(rel_under(&root_canon, &target))
}

/// Delete a single image and its sidecar. Folders go through delete_gallery_folder.
#[tauri::command]
async fn delete_gallery_image(
    rel: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if rel.trim().is_empty()
        || rel.contains("..")
        || rel.starts_with('/')
        || rel.starts_with('\\')
    {
        return Err("invalid path".into());
    }
    let root = state.output_dir.lock().unwrap().clone();
    let src = root.join(rel.replace('\\', "/"));
    let src_canon = tokio::fs::canonicalize(&src)
        .await
        .map_err(|e| format!("not found: {}", e))?;
    let root_canon = tokio::fs::canonicalize(&root)
        .await
        .map_err(|e| e.to_string())?;
    if !src_canon.starts_with(&root_canon) || src_canon == root_canon {
        return Err("path escapes output_dir".into());
    }
    if src_canon.is_dir() {
        return Err("expected a file, got a directory".into());
    }
    let filename = src_canon
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("bad name")?
        .to_string();
    let sidecar = src_canon
        .parent()
        .ok_or("no parent")?
        .join(format!("{}.json", filename));

    tokio::fs::remove_file(&src_canon)
        .await
        .map_err(|e| e.to_string())?;
    if sidecar.exists() {
        let _ = tokio::fs::remove_file(&sidecar).await;
    }
    Ok(())
}

/// Create a new empty folder under `parent` (relative to output_dir, "" = root).
/// Returns the new folder's relative path.
#[tauri::command]
async fn create_gallery_folder(
    parent: Option<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let parent = parent.unwrap_or_default();
    if parent.contains("..") || parent.starts_with('/') || parent.starts_with('\\') {
        return Err("invalid parent path".into());
    }
    let safe = sanitize_segment(&name);
    if safe.is_empty() {
        return Err("invalid folder name".into());
    }
    let root = state.output_dir.lock().unwrap().clone();
    let parent_dir = if parent.is_empty() {
        root.clone()
    } else {
        root.join(parent.replace('\\', "/"))
    };
    tokio::fs::create_dir_all(&parent_dir)
        .await
        .map_err(|e| e.to_string())?;
    let target = parent_dir.join(&safe);
    if target.exists() {
        return Err(format!("\"{}\" already exists", safe));
    }
    tokio::fs::create_dir(&target)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rel_under(&root, &target))
}

/// Move a file or folder from `src_rel` into `dest_folder_rel` (both relative
/// to output_dir; dest "" = root). Image sidecars move along with images.
/// Returns the new relative path of the moved item.
#[tauri::command]
async fn move_gallery_item(
    src_rel: String,
    dest_folder_rel: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if src_rel.trim().is_empty()
        || src_rel.contains("..")
        || src_rel.starts_with('/')
        || src_rel.starts_with('\\')
    {
        return Err("invalid source path".into());
    }
    if dest_folder_rel.contains("..")
        || dest_folder_rel.starts_with('/')
        || dest_folder_rel.starts_with('\\')
    {
        return Err("invalid destination path".into());
    }

    let root = state.output_dir.lock().unwrap().clone();
    let src = root.join(src_rel.replace('\\', "/"));
    let src_canon = tokio::fs::canonicalize(&src)
        .await
        .map_err(|e| format!("source not found: {}", e))?;
    let root_canon = tokio::fs::canonicalize(&root)
        .await
        .map_err(|e| e.to_string())?;
    if !src_canon.starts_with(&root_canon) || src_canon == root_canon {
        return Err("source escapes output_dir".into());
    }

    let dest_dir = if dest_folder_rel.is_empty() {
        root.clone()
    } else {
        root.join(dest_folder_rel.replace('\\', "/"))
    };
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| e.to_string())?;
    let dest_canon = tokio::fs::canonicalize(&dest_dir)
        .await
        .map_err(|e| format!("destination not found: {}", e))?;
    if !dest_canon.starts_with(&root_canon) {
        return Err("destination escapes output_dir".into());
    }

    let was_dir = src_canon.is_dir();
    if was_dir && dest_canon.starts_with(&src_canon) {
        return Err("can't move a folder into itself or a descendant".into());
    }

    let src_filename = src_canon
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("bad source name")?
        .to_string();
    let mut target = dest_canon.join(&src_filename);

    if target == src_canon {
        return Ok(src_rel);
    }

    // Collision: append " (2)", " (3)", … keeping any extension.
    if target.exists() {
        let (base, ext) = if was_dir {
            (src_filename.clone(), String::new())
        } else {
            match src_filename.rsplit_once('.') {
                Some((s, e)) => (s.to_string(), format!(".{}", e)),
                None => (src_filename.clone(), String::new()),
            }
        };
        for n in 2..1000u32 {
            let candidate = dest_canon.join(format!("{} ({}){}", base, n, ext));
            if !candidate.exists() {
                target = candidate;
                break;
            }
        }
    }

    let target_filename = target
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("bad target name")?
        .to_string();
    let src_sidecar = src_canon
        .parent()
        .map(|p| p.join(format!("{}.json", src_filename)));
    let target_sidecar = target
        .parent()
        .map(|p| p.join(format!("{}.json", target_filename)));
    let move_sidecar = !was_dir
        && src_sidecar
            .as_ref()
            .map(|s| s.exists())
            .unwrap_or(false);

    tokio::fs::rename(&src_canon, &target)
        .await
        .map_err(|e| e.to_string())?;

    if move_sidecar {
        if let (Some(s), Some(t)) = (src_sidecar, target_sidecar) {
            let _ = tokio::fs::rename(&s, &t).await;
        }
    }

    Ok(rel_under(&root_canon, &target))
}

/// Convert an existing gallery image to pixel art. Writes a new file
/// alongside the source as `{stem}-pixel-{size}.png`, copies + annotates the
/// sidecar so the gallery shows the right provider hue and a tagged prompt.
#[tauri::command]
async fn pixelate_image(
    rel: String,
    size: u32,
    upscale: Option<bool>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if rel.trim().is_empty()
        || rel.contains("..")
        || rel.starts_with('/')
        || rel.starts_with('\\')
    {
        return Err("invalid path".into());
    }
    let size = size.max(4).min(2048);

    let root = state.output_dir.lock().unwrap().clone();
    let src = root.join(rel.replace('\\', "/"));
    let src_canon = tokio::fs::canonicalize(&src)
        .await
        .map_err(|e| format!("source not found: {}", e))?;
    let root_canon = tokio::fs::canonicalize(&root)
        .await
        .map_err(|e| e.to_string())?;
    if !src_canon.starts_with(&root_canon) {
        return Err("path escapes output_dir".into());
    }
    if src_canon.is_dir() {
        return Err("expected an image, got a directory".into());
    }

    let parent = src_canon.parent().ok_or("no parent")?.to_path_buf();
    let stem = src_canon
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("bad source name")?
        .to_string();
    let src_filename = src_canon
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("bad source name")?
        .to_string();

    // Pick a non-colliding target filename.
    let mut target = parent.join(format!("{}-pixel-{}.png", stem, size));
    if target.exists() {
        for n in 2..1000u32 {
            let candidate = parent.join(format!("{}-pixel-{}-{}.png", stem, size, n));
            if !candidate.exists() {
                target = candidate;
                break;
            }
        }
    }

    pixelate::pixelate_file(
        src_canon.clone(),
        target.clone(),
        size,
        upscale.unwrap_or(true),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Decorate the sidecar so the gallery treats this as a derivative with
    // the same provider hue, while making clear it's a pixel-art version.
    let src_sidecar = parent.join(format!("{}.json", src_filename));
    if src_sidecar.exists() {
        if let Ok(raw) = tokio::fs::read_to_string(&src_sidecar).await {
            if let Ok(mut meta) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(obj) = meta.as_object_mut() {
                    let original_prompt = obj
                        .get("prompt")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    obj.insert(
                        "prompt".to_string(),
                        serde_json::json!(if original_prompt.is_empty() {
                            format!("pixel · {}px", size)
                        } else {
                            format!("{} · pixel {}px", original_prompt, size)
                        }),
                    );
                    let extras = serde_json::json!({
                        "pixelated_from": src_filename,
                        "pixel_size": size,
                        "upscaled": upscale.unwrap_or(true),
                    });
                    if let Some(params) =
                        obj.get_mut("params").and_then(|v| v.as_object_mut())
                    {
                        if let Some(extras_obj) = extras.as_object() {
                            for (k, v) in extras_obj {
                                params.insert(k.clone(), v.clone());
                            }
                        }
                    } else {
                        obj.insert("params".to_string(), extras);
                    }
                }
                if let Some(target_filename) =
                    target.file_name().and_then(|s| s.to_str())
                {
                    let target_sidecar =
                        parent.join(format!("{}.json", target_filename));
                    if let Ok(bytes) = serde_json::to_vec_pretty(&meta) {
                        let _ = tokio::fs::write(&target_sidecar, bytes).await;
                    }
                }
            }
        }
    }

    Ok(rel_under(&root_canon, &target))
}

#[tauri::command]
fn cancel_bulk(state: State<'_, AppState>) -> Result<bool, String> {
    let lock = state.bulk_cancel.lock().unwrap();
    if let Some(flag) = lock.as_ref() {
        flag.store(true, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn read_image_b64(path: String) -> Result<String, String> {
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Recursively delete a gallery folder. The path is resolved relative to
/// the configured `output_dir` and validated against it after canonicalize
/// so symlinks/.. tricks can't escape the gallery root.
#[tauri::command]
async fn delete_gallery_folder(
    rel: String,
    state: State<'_, AppState>,
) -> Result<u32, String> {
    if rel.trim().is_empty()
        || rel.contains("..")
        || rel.starts_with('/')
        || rel.starts_with('\\')
    {
        return Err("invalid path".into());
    }
    let root = state.output_dir.lock().unwrap().clone();
    let target = root.join(rel.replace('\\', "/"));
    let target_canon = tokio::fs::canonicalize(&target)
        .await
        .map_err(|e| format!("not found: {}", e))?;
    let root_canon = tokio::fs::canonicalize(&root)
        .await
        .map_err(|e| e.to_string())?;
    if !target_canon.starts_with(&root_canon) || target_canon == root_canon {
        return Err("path escapes output_dir".into());
    }
    if !target_canon.is_dir() {
        return Err("not a directory".into());
    }
    let count = count_images_recursive(&target_canon).await.unwrap_or(0);
    tokio::fs::remove_dir_all(&target_canon)
        .await
        .map_err(|e| e.to_string())?;
    Ok(count)
}

/// Copy a list of images into a destination directory. Each file keeps its
/// basename; collisions get an `(N)` suffix. Returns the new paths.
/// `subfolder` (optional) is appended to `dest` and created if missing —
/// users can highlight a parent folder and add `tiles/grass` in one go.
#[tauri::command]
async fn copy_images_to(
    paths: Vec<String>,
    dest: String,
    subfolder: Option<String>,
) -> Result<Vec<String>, String> {
    let mut dest_dir = PathBuf::from(&dest);
    if let Some(sub) = subfolder {
        let trimmed = sub.trim().trim_matches('/').trim_matches('\\');
        if !trimmed.is_empty() && !trimmed.contains("..") {
            for seg in trimmed.split(['/', '\\']) {
                let safe: String = seg
                    .chars()
                    .filter(|c| {
                        c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ')
                    })
                    .collect();
                if !safe.is_empty() {
                    dest_dir = dest_dir.join(safe.trim());
                }
            }
        }
    }
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| e.to_string())?;
    let mut written = Vec::with_capacity(paths.len());
    for src in paths {
        let src_path = PathBuf::from(&src);
        let name = src_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("bad path: {}", src))?
            .to_string();
        let mut target = dest_dir.join(&name);
        if target.exists() {
            let (stem, ext) = match name.rsplit_once('.') {
                Some((s, e)) => (s.to_string(), format!(".{}", e)),
                None => (name.clone(), String::new()),
            };
            for n in 2..1000u32 {
                let candidate = dest_dir.join(format!("{} ({}){}", stem, n, ext));
                if !candidate.exists() {
                    target = candidate;
                    break;
                }
            }
        }
        tokio::fs::copy(&src_path, &target)
            .await
            .map_err(|e| format!("{}: {}", src, e))?;
        written.push(target.to_string_lossy().to_string());
    }
    Ok(written)
}

// ─── Model listing ─────────────────────────────────────────────────────────

#[tauri::command]
async fn list_models(
    provider: String,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<ModelInfo>, String> {
    let p = Provider::from_str(&provider)
        .ok_or_else(|| format!("unknown provider: {}", provider))?;
    if !force_refresh.unwrap_or(false) {
        if let Some(list) = state.model_cache.lock().unwrap().get(&p).cloned() {
            return Ok(list);
        }
    }
    let key = keys::get_key(p.as_str()).map_err(|e| e.to_string())?;
    let list = providers::list_models(p, key.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    state.model_cache.lock().unwrap().insert(p, list.clone());
    Ok(list)
}

// ─── GitHub commands ───────────────────────────────────────────────────────

#[derive(Serialize)]
struct GitHubStatus {
    username: String,
    remote: Option<String>,
}

#[tauri::command]
async fn github_connect(
    token: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let gh = GitHub::new(token.clone());
    let username = gh.whoami().await.map_err(|e| e.to_string())?;
    keys::set_key(GITHUB_KEY_NAME, &token).map_err(|e| e.to_string())?;
    *state.github_username.lock().unwrap() = Some(username.clone());
    Ok(username)
}

#[tauri::command]
async fn github_status(
    state: State<'_, AppState>,
) -> Result<Option<GitHubStatus>, String> {
    let cached = state.github_username.lock().unwrap().clone();
    let username = if let Some(u) = cached {
        Some(u)
    } else if let Some(token) = keys::get_key(GITHUB_KEY_NAME).map_err(|e| e.to_string())? {
        match GitHub::new(token).whoami().await {
            Ok(u) => {
                *state.github_username.lock().unwrap() = Some(u.clone());
                Some(u)
            }
            Err(_) => None,
        }
    } else {
        None
    };
    let Some(username) = username else {
        return Ok(None);
    };
    let remote = state.git_remote.lock().unwrap().clone();
    Ok(Some(GitHubStatus { username, remote }))
}

#[tauri::command]
async fn github_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    keys::delete_key(GITHUB_KEY_NAME).map_err(|e| e.to_string())?;
    *state.github_username.lock().unwrap() = None;
    *state.git_remote.lock().unwrap() = None;
    state.persist()
}

#[tauri::command]
async fn github_list_repos(_state: State<'_, AppState>) -> Result<Vec<GhRepo>, String> {
    let token = keys::get_key(GITHUB_KEY_NAME)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "GitHub not connected".to_string())?;
    GitHub::new(token)
        .list_repos()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn github_create_repo(
    name: String,
    private: bool,
    _state: State<'_, AppState>,
) -> Result<GhRepo, String> {
    let token = keys::get_key(GITHUB_KEY_NAME)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "GitHub not connected".to_string())?;
    GitHub::new(token)
        .create_repo(&name, private)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn github_set_remote(
    clone_url: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let out_dir = state.output_dir.lock().unwrap().clone();
    git::ensure_init(&out_dir).await.map_err(|e| e.to_string())?;
    git::set_remote(&out_dir, &clone_url)
        .await
        .map_err(|e| e.to_string())?;
    *state.git_remote.lock().unwrap() = Some(clone_url);
    state.persist()
}

#[tauri::command]
async fn github_clear_remote(state: State<'_, AppState>) -> Result<(), String> {
    *state.git_remote.lock().unwrap() = None;
    state.persist()
}

// ─── Helpers ───────────────────────────────────────────────────────────────

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let t: String = s.chars().take(n).collect();
        format!("{}…", t)
    }
}

// ─── Entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = std::fs::create_dir_all(&app_data);
            let cfg = config::load(&app_data);
            let output_dir = cfg
                .output_dir
                .as_ref()
                .map(PathBuf::from)
                .filter(|p| p.as_os_str().len() > 0)
                .unwrap_or_else(|| app_data.clone());
            app.manage(AppState {
                app_data,
                output_dir: Mutex::new(output_dir),
                git_enabled: Mutex::new(cfg.git_enabled),
                git_remote: Mutex::new(cfg.git_remote),
                github_username: Mutex::new(None),
                model_cache: Mutex::new(HashMap::new()),
                bulk_cancel: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_key,
            get_key_status,
            delete_key,
            get_output_dir,
            set_output_dir,
            get_git_enabled,
            set_git_enabled,
            generate_single,
            generate_bulk,
            cancel_bulk,
            list_gallery,
            list_gallery_dir,
            delete_gallery_folder,
            delete_gallery_image,
            create_gallery_folder,
            move_gallery_item,
            rename_gallery_item,
            reorder_gallery_folder,
            read_image_b64,
            copy_images_to,
            pixelate_image,
            list_models,
            github_connect,
            github_status,
            github_disconnect,
            github_list_repos,
            github_create_repo,
            github_set_remote,
            github_clear_remote,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri");
}
