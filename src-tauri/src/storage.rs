use chrono::Local;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Serialize)]
pub struct ImageMeta {
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub size: String,
    pub seed: Option<u64>,
    pub created_at: String,
    pub params: serde_json::Value,
}

pub async fn save_image(
    root: &Path,
    provider: &str,
    bytes: &[u8],
    mime: &str,
    meta: &ImageMeta,
    override_name: Option<&str>,
    override_folder: Option<&str>,
) -> anyhow::Result<PathBuf> {
    // If the user supplied `;path/like/this` in the prompt, use it directly
    // under the output root (no date/provider hierarchy). Otherwise fall back
    // to the default `generated/{provider}/{YYYY-MM-DD}/` layout.
    let dir = if let Some(folder) = override_folder {
        root.join(folder)
    } else {
        let today = Local::now().format("%Y-%m-%d").to_string();
        root.join("generated").join(provider).join(&today)
    };
    fs::create_dir_all(&dir).await?;

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash = format!("{:x}", hasher.finalize());
    let short = &hash[..10];

    let mime_ext = match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    };

    // If the user supplied `:name.ext` at the end of the prompt, honor it.
    // Sanitize to filesystem-safe chars and resolve collisions by appending
    // the short hash, so two identical names from different runs don't clobber.
    let image_name = if let Some(raw) = override_name {
        let sanitized = sanitize_filename(raw);
        if sanitized.is_empty() {
            default_name(&meta.prompt, short, mime_ext)
        } else {
            // If the sanitized name has no recognized image extension, append
            // the mime-derived one. Otherwise keep what the user asked for.
            let lower = sanitized.to_lowercase();
            let has_ext = lower.ends_with(".png")
                || lower.ends_with(".jpg")
                || lower.ends_with(".jpeg")
                || lower.ends_with(".webp");
            let candidate = if has_ext {
                sanitized
            } else {
                format!("{}.{}", sanitized, mime_ext)
            };
            // Collision: if `name.ext` exists, become `name-{hash10}.ext`.
            if dir.join(&candidate).exists() {
                let (stem, ext) = split_ext(&candidate);
                format!("{}-{}.{}", stem, short, ext)
            } else {
                candidate
            }
        }
    } else {
        default_name(&meta.prompt, short, mime_ext)
    };

    let meta_name = format!("{}.json", image_name);
    let image_path = dir.join(&image_name);
    let meta_path = dir.join(&meta_name);

    fs::write(&image_path, bytes).await?;
    fs::write(&meta_path, serde_json::to_vec_pretty(meta)?).await?;
    Ok(image_path)
}

fn default_name(prompt: &str, short_hash: &str, ext: &str) -> String {
    let raw_slug = slug::slugify(prompt);
    let slug: String = if raw_slug.is_empty() {
        "untitled".into()
    } else {
        raw_slug.chars().take(50).collect()
    };
    format!("{}-{}.{}", slug, short_hash, ext)
}

fn sanitize_filename(s: &str) -> String {
    s.trim()
        .chars()
        .filter(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '-' | '_' | '.' | ' ')
        })
        .map(|c| if c == ' ' { '-' } else { c })
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) => (&name[..i], &name[i + 1..]),
        None => (name, ""),
    }
}

/// If a prompt ends with `:filename.ext` or `:folder/path/filename.ext`,
/// returns (prompt_without_suffix, optional_folder, optional_filename).
/// Allowed image extensions: png, jpg, jpeg, webp.
pub fn extract_filename_suffix(
    prompt: &str,
) -> (String, Option<String>, Option<String>) {
    let Some(idx) = prompt.rfind(':') else {
        return (prompt.to_string(), None, None);
    };
    let suffix = prompt[idx + 1..].trim();
    if suffix.is_empty()
        || suffix.starts_with('/')
        || suffix.starts_with('\\')
        || suffix.contains("..")
    {
        return (prompt.to_string(), None, None);
    }
    let lower = suffix.to_lowercase();
    let has_ext = lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".webp");
    if !has_ext {
        return (prompt.to_string(), None, None);
    }
    let cleaned = prompt[..idx].trim_end().to_string();
    if cleaned.is_empty() {
        return (prompt.to_string(), None, None);
    }

    // Split into folder + filename. Last segment is the filename; anything
    // before is the folder path. Each path segment is sanitized.
    let parts: Vec<&str> = suffix.split(['/', '\\']).collect();
    let (folder_parts, name) = parts.split_at(parts.len() - 1);
    let name = name[0].to_string();
    if name.is_empty() {
        return (prompt.to_string(), None, None);
    }
    let folder: Option<String> = if folder_parts.is_empty() {
        None
    } else {
        let safe: Vec<String> = folder_parts
            .iter()
            .map(|seg| sanitize_filename(seg))
            .filter(|s| !s.is_empty())
            .collect();
        if safe.is_empty() {
            None
        } else {
            Some(safe.join("/"))
        }
    };
    (cleaned, folder, Some(name))
}

/// If a prompt contains `;<folder/path>` (after the `:name.ext` suffix has
/// already been stripped), returns (prompt_without_folder, Some(folder)).
/// Folder paths are sanitized to safe segments and may not escape via `..`
/// or absolute paths.
pub fn extract_folder_suffix(prompt: &str) -> (String, Option<String>) {
    let Some(idx) = prompt.rfind(';') else {
        return (prompt.to_string(), None);
    };
    let suffix = prompt[idx + 1..].trim();
    if suffix.is_empty()
        || suffix.starts_with('/')
        || suffix.starts_with('\\')
        || suffix.contains("..")
    {
        return (prompt.to_string(), None);
    }
    let cleaned_prompt = prompt[..idx].trim_end().to_string();
    if cleaned_prompt.is_empty() {
        return (prompt.to_string(), None);
    }
    let parts: Vec<String> = suffix
        .split(['/', '\\'])
        .map(|seg| sanitize_filename(seg))
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        return (prompt.to_string(), None);
    }
    (cleaned_prompt, Some(parts.join("/")))
}

/// Convenience: parse folder and filename suffixes from a prompt. Two valid
/// shapes (combinable):
///   - `<text>:<folder>/<filename.ext>` — folder + filename in one suffix
///   - `<text>;<folder>:<filename.ext>` — folder via `;`, name via `:`
/// A folder embedded in the `:` suffix wins; the `;` form remains as a
/// fallback for prompts that supply only a folder.
pub fn parse_prompt_suffixes(
    prompt: &str,
) -> (String, Option<String>, Option<String>) {
    let (after_name, folder_from_name, name) = extract_filename_suffix(prompt);
    let (after_folder, folder_from_semi) = extract_folder_suffix(&after_name);
    let folder = folder_from_name.or(folder_from_semi);
    (after_folder, folder, name)
}
