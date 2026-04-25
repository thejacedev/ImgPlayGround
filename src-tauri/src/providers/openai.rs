use super::{http_client, GenOutput, GenParams, ModelInfo};
use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct Req<'a> {
    model: &'a str,
    prompt: &'a str,
    n: u32,
    size: &'a str,
}

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
    let resp = client
        .post("https://api.openai.com/v1/images/generations")
        .bearer_auth(api_key)
        .json(&Req {
            model,
            prompt: &p.prompt,
            n: p.n,
            size: &p.size,
        })
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
            mime: "image/png".into(),
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
