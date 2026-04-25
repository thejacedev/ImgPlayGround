use super::{aspect_from_size, http_client, GenOutput, GenParams, ModelInfo};
use base64::Engine;
use serde::Deserialize;

#[derive(Deserialize)]
struct Resp {
    predictions: Vec<Pred>,
}

#[derive(Deserialize)]
struct Pred {
    #[serde(rename = "bytesBase64Encoded")]
    bytes_base64_encoded: Option<String>,
}

pub async fn generate(api_key: &str, p: &GenParams) -> anyhow::Result<Vec<GenOutput>> {
    let model = p
        .model
        .as_deref()
        .unwrap_or("imagen-4.0-generate-001");
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:predict?key={}",
        model, api_key
    );
    let body = serde_json::json!({
        "instances": [{ "prompt": p.prompt }],
        "parameters": {
            "sampleCount": p.n,
            "aspectRatio": aspect_from_size(&p.size),
        }
    });
    let resp = http_client().post(&url).json(&body).send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Google {}: {}", status, text);
    }
    let r: Resp = resp.json().await?;
    let mut out = Vec::new();
    for pred in r.predictions {
        if let Some(b) = pred.bytes_base64_encoded {
            let bytes = base64::engine::general_purpose::STANDARD.decode(b)?;
            out.push(GenOutput {
                bytes,
                mime: "image/png".into(),
                seed: None,
                model: model.into(),
            });
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
struct ModelsResp {
    models: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    name: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

pub async fn list_models(api_key: Option<&str>) -> anyhow::Result<Vec<ModelInfo>> {
    let Some(key) = api_key else {
        return Ok(vec![ModelInfo {
            id: "imagen-4.0-generate-001".into(),
            label: "Imagen 4".into(),
        }]);
    };
    let r: ModelsResp = http_client()
        .get(format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            key
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut out: Vec<ModelInfo> = r
        .models
        .into_iter()
        .filter(|m| m.name.contains("imagen"))
        .map(|m| {
            let id = m.name.trim_start_matches("models/").to_string();
            ModelInfo {
                label: m.display_name.unwrap_or_else(|| id.clone()),
                id,
            }
        })
        .collect();
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}
