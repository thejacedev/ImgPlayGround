use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Config {
    pub output_dir: Option<String>,
    pub git_enabled: bool,
    pub git_remote: Option<String>,
}

fn config_path(app_data: &Path) -> PathBuf {
    app_data.join("config.json")
}

pub fn load(app_data: &Path) -> Config {
    let path = config_path(app_data);
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(app_data: &Path, cfg: &Config) -> anyhow::Result<()> {
    std::fs::create_dir_all(app_data)?;
    let path = config_path(app_data);
    std::fs::write(&path, serde_json::to_vec_pretty(cfg)?)?;
    Ok(())
}
