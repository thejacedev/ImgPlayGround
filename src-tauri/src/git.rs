use std::path::Path;
use tokio::process::Command;

pub async fn ensure_init(dir: &Path) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dir).await?;
    if dir.join(".git").exists() {
        return Ok(());
    }
    let out = Command::new("git")
        .args(["init", "-q", "-b", "main"])
        .current_dir(dir)
        .output()
        .await?;
    if !out.status.success() {
        anyhow::bail!(
            "git init failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let _ = Command::new("git")
        .args(["config", "user.email", "imgplayground@local"])
        .current_dir(dir)
        .status()
        .await;
    let _ = Command::new("git")
        .args(["config", "user.name", "ImgPlayGround"])
        .current_dir(dir)
        .status()
        .await;
    Ok(())
}

pub async fn commit_all(dir: &Path, message: &str) -> anyhow::Result<bool> {
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(dir)
        .output()
        .await?;
    if status.stdout.is_empty() {
        return Ok(false);
    }

    let out = Command::new("git")
        .args(["add", "."])
        .current_dir(dir)
        .output()
        .await?;
    if !out.status.success() {
        anyhow::bail!("git add failed: {}", String::from_utf8_lossy(&out.stderr));
    }

    let out = Command::new("git")
        .args(["commit", "-q", "-m", message])
        .current_dir(dir)
        .output()
        .await?;
    if !out.status.success() {
        anyhow::bail!(
            "git commit failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(true)
}

/// Set `origin` to the given clone URL (creates it, or updates if it exists).
/// Clone URL should be the clean one (no embedded credentials).
pub async fn set_remote(dir: &Path, clone_url: &str) -> anyhow::Result<()> {
    let existing = Command::new("git")
        .args(["remote"])
        .current_dir(dir)
        .output()
        .await?;
    let has_origin = String::from_utf8_lossy(&existing.stdout)
        .lines()
        .any(|l| l.trim() == "origin");
    let args: &[&str] = if has_origin {
        &["remote", "set-url", "origin", clone_url]
    } else {
        &["remote", "add", "origin", clone_url]
    };
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .await?;
    if !out.status.success() {
        anyhow::bail!(
            "git remote failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(())
}

#[allow(dead_code)] // Used by future "show current remote" UI; kept on the public surface.
pub async fn get_remote(dir: &Path) -> anyhow::Result<Option<String>> {
    if !dir.join(".git").exists() {
        return Ok(None);
    }
    let out = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(dir)
        .output()
        .await?;
    if !out.status.success() {
        return Ok(None);
    }
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if url.is_empty() {
        Ok(None)
    } else {
        Ok(Some(url))
    }
}

/// Ensure HEAD is on a branch named `main`. Safe to call repeatedly.
pub async fn ensure_main_branch(dir: &Path) -> anyhow::Result<()> {
    let _ = Command::new("git")
        .args(["branch", "-M", "main"])
        .current_dir(dir)
        .output()
        .await?;
    Ok(())
}

/// Push HEAD to `main` on a remote specified by the given tokenized URL.
/// The URL is used once and never stored.
pub async fn push_to(dir: &Path, tokenized_url: &str) -> anyhow::Result<()> {
    ensure_main_branch(dir).await?;
    let out = Command::new("git")
        .args(["push", tokenized_url, "HEAD:main"])
        .current_dir(dir)
        .output()
        .await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // Scrub any stray token that might appear in a URL echo.
        let scrubbed = scrub_token(&stderr, tokenized_url);
        anyhow::bail!("git push failed: {}", scrubbed);
    }
    Ok(())
}

fn scrub_token(s: &str, tokenized_url: &str) -> String {
    // Strip `x-access-token:TOKEN@` to just `x-access-token:***@`
    if let Some(start) = tokenized_url.find("x-access-token:") {
        let after = &tokenized_url[start + "x-access-token:".len()..];
        if let Some(at) = after.find('@') {
            let token = &after[..at];
            return s.replace(token, "***");
        }
    }
    s.to_string()
}
