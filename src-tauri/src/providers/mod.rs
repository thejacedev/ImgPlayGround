pub mod bfl;
pub mod fal;
pub mod google;
pub mod openai;
pub mod replicate;
pub mod stability;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenParams {
    pub prompt: String,
    pub n: u32,
    pub size: String,
    pub model: Option<String>,
    pub seed: Option<u64>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug)]
pub struct GenOutput {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub seed: Option<u64>,
    pub model: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    OpenAI,
    Google,
    Stability,
    Replicate,
    Fal,
    Bfl,
}

impl Provider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::OpenAI => "openai",
            Provider::Google => "google",
            Provider::Stability => "stability",
            Provider::Replicate => "replicate",
            Provider::Fal => "fal",
            Provider::Bfl => "bfl",
        }
    }
    pub fn from_str(s: &str) -> Option<Provider> {
        match s {
            "openai" => Some(Provider::OpenAI),
            "google" => Some(Provider::Google),
            "stability" => Some(Provider::Stability),
            "replicate" => Some(Provider::Replicate),
            "fal" => Some(Provider::Fal),
            "bfl" => Some(Provider::Bfl),
            _ => None,
        }
    }
}

pub async fn generate(
    provider: Provider,
    api_key: &str,
    params: &GenParams,
) -> anyhow::Result<Vec<GenOutput>> {
    match provider {
        Provider::OpenAI => openai::generate(api_key, params).await,
        Provider::Google => google::generate(api_key, params).await,
        Provider::Stability => stability::generate(api_key, params).await,
        Provider::Replicate => replicate::generate(api_key, params).await,
        Provider::Fal => fal::generate(api_key, params).await,
        Provider::Bfl => bfl::generate(api_key, params).await,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
}

/// Returns the set of models for a provider. Adapters that expose a
/// public listing endpoint hit it with the provided key. Adapters that
/// don't (Stability/Fal/BFL) return a curated static list and ignore the key.
pub async fn list_models(
    provider: Provider,
    api_key: Option<&str>,
) -> anyhow::Result<Vec<ModelInfo>> {
    match provider {
        Provider::OpenAI => openai::list_models(api_key).await,
        Provider::Google => google::list_models(api_key).await,
        Provider::Stability => Ok(stability::list_models()),
        Provider::Replicate => replicate::list_models(api_key).await,
        Provider::Fal => Ok(fal::list_models()),
        Provider::Bfl => Ok(bfl::list_models()),
    }
}

pub(crate) fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("ImgPlayGround/0.1")
        .build()
        .expect("reqwest client")
}

pub(crate) fn aspect_from_size(size: &str) -> &'static str {
    match size {
        "1024x1024" | "1:1" => "1:1",
        "1344x768" | "16:9" => "16:9",
        "768x1344" | "9:16" => "9:16",
        "1152x896" | "4:3" => "4:3",
        "896x1152" | "3:4" => "3:4",
        _ => "1:1",
    }
}

pub(crate) fn dims_from_size(size: &str) -> (u32, u32) {
    if let Some((w, h)) = size.split_once('x') {
        if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
            return (w, h);
        }
    }
    match size {
        "16:9" => (1344, 768),
        "9:16" => (768, 1344),
        "4:3" => (1152, 896),
        "3:4" => (896, 1152),
        _ => (1024, 1024),
    }
}
