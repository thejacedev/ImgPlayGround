use super::{http_client, GenOutput, GenParams, ModelInfo};
use base64::Engine;
use serde::Deserialize;

#[derive(Deserialize)]
struct Resp {
    data: Vec<Image>,
}

#[derive(Deserialize)]
struct Image {
    b64_json: Option<String>,
    url: Option<String>,
}

pub async fn generate(api_key: &str, p: &GenParams) -> anyhow::Result<Vec<GenOutput>> {
    let model = p.model.as_deref().unwrap_or("gpt-image-2");
    let client = http_client();

    let mut body = serde_json::json!({
        "model": model,
        "prompt": p.prompt,
        "n": p.n,
        "size": p.size,
    });

    let supports_extras = model.starts_with("gpt-image");
    let mut output_format: Option<String> = None;
    if supports_extras {
        let mut background: Option<String> = None;
        if let Some(extra) = &p.extra {
            if let Some(obj) = extra.as_object() {
                if let Some(v) = obj.get("background").and_then(|v| v.as_str()) {
                    background = Some(v.to_string());
                }
                if let Some(v) = obj.get("output_format").and_then(|v| v.as_str()) {
                    output_format = Some(v.to_string());
                }
            }
        }
        if let Some(bg) = background.as_deref() {
            body["background"] = serde_json::json!(bg);
            if bg == "transparent"
                && output_format.as_deref().map(|s| s == "jpeg").unwrap_or(true)
            {
                output_format = Some("png".into());
            }
        }
        if let Some(fmt) = &output_format {
            body["output_format"] = serde_json::json!(fmt);
        }
    }
    let mime = match output_format.as_deref() {
        Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "image/png",
    };

    let resp = client
        .post("https://api.openai.com/v1/images/generations")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("OpenAI {}: {}", status, body);
    }
    let r: Resp = resp.json().await?;

    let mut out = Vec::new();
    for img in r.data {
        let bytes = if let Some(b) = img.b64_json {
            base64::engine::general_purpose::STANDARD.decode(b)?
        } else if let Some(u) = img.url {
            client
                .get(&u)
                .send()
                .await?
                .error_for_status()?
                .bytes()
                .await?
                .to_vec()
        } else {
            continue;
        };
        out.push(GenOutput {
            bytes,
            mime: mime.into(),
            seed: None,
            model: model.into(),
        });
    }
    Ok(out)
}

#[derive(Deserialize)]
struct ModelsResp {
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

pub async fn list_models(api_key: Option<&str>) -> anyhow::Result<Vec<ModelInfo>> {
    let Some(key) = api_key else {
        return Ok(vec![ModelInfo {
            id: "gpt-image-2".into(),
            label: "gpt-image-2".into(),
        }]);
    };
    let r: ModelsResp = http_client()
        .get("https://api.openai.com/v1/models")
        .bearer_auth(key)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut out: Vec<ModelInfo> = r
        .data
        .into_iter()
        .filter(|m| m.id.starts_with("gpt-image") || m.id.starts_with("dall-e"))
        .map(|m| ModelInfo {
            label: m.id.clone(),
            id: m.id,
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}
