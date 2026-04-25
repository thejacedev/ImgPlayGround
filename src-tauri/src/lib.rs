mod config;
mod git;
mod github;
mod keys;
mod providers;
mod storage;

use base64::Engine;
use github::{GitHub, Repo as GhRepo};
use providers::{GenParams, ModelInfo, Provider};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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

    stream::iter(jobs.into_iter().enumerate().map(|(idx, (provider, prompt))| {
        let app = app.clone();
        let results = results.clone();
        let completed = completed.clone();
        let failed = failed.clone();
        let out_dir = out_dir.clone();
        let size = size.clone();
        async move {
            let res =
                run_one(&provider, &prompt, n, &size, None, None, None, &out_dir, &app)
                    .await;
            let success = res.is_ok();
            let r = match res {
                Ok(paths) => {
                    completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    GenResult {
                        provider: provider.clone(),
                        paths,
                        error: None,
                    }
                }
                Err(e) => {
                    failed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
                }),
            );
            let _ = app.emit(
                "bulk-progress",
                BulkProgress {
                    total,
                    completed: completed.load(std::sync::atomic::Ordering::Relaxed),
                    failed: failed.load(std::sync::atomic::Ordering::Relaxed),
                },
            );
        }
    }))
    .buffer_unordered(concurrency)
    .collect::<Vec<_>>()
    .await;

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
    path: String,
    provider: String,
    prompt: String,
    created_at: String,
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
    let mut stack = vec![root];
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

#[tauri::command]
async fn read_image_b64(path: String) -> Result<String, String> {
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
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
            list_gallery,
            read_image_b64,
            copy_images_to,
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
