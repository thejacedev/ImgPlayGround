use super::{aspect_from_size, http_client, GenOutput, GenParams, ModelInfo};
use serde::Deserialize;

#[derive(Deserialize)]
struct Prediction {
    status: String,
    output: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
    urls: Option<Urls>,
}

#[derive(Deserialize)]
struct Urls {
    get: Option<String>,
}

pub async fn generate(api_key: &str, p: &GenParams) -> anyhow::Result<Vec<GenOutput>> {
    let model = p
        .model
        .as_deref()
        .unwrap_or("black-forest-labs/flux-1.1-pro");
    let url = format!("https://api.replicate.com/v1/models/{}/predictions", model);
    let aspect = aspect_from_size(&p.size);
    let client = http_client();

    let mut input = serde_json::json!({
        "prompt": p.prompt,
        "aspect_ratio": aspect,
        "output_format": "png",
    });
    if let Some(seed) = p.seed {
        input["seed"] = serde_json::json!(seed);
    }
    if let Some(extra) = &p.extra {
        if let Some(obj) = extra.as_object() {
            for (k, v) in obj {
                input[k] = v.clone();
            }
        }
    }
    let body = serde_json::json!({ "input": input });

    let mut out = Vec::new();
    for _ in 0..p.n {
        let resp = client
            .post(&url)
            .bearer_auth(api_key)
            .header("Prefer", "wait=60")
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Replicate {}: {}", status, text);
        }
        let mut pred: Prediction = resp.json().await?;

        while pred.status != "succeeded"
            && pred.status != "failed"
            && pred.status != "canceled"
        {
            let get_url = pred
                .urls
                .as_ref()
                .and_then(|u| u.get.clone())
                .ok_or_else(|| anyhow::anyhow!("no poll url"))?;
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            pred = client
                .get(&get_url)
                .bearer_auth(api_key)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
        }

        if pred.status != "succeeded" {
            if let Some(e) = pred.error {
                anyhow::bail!("Replicate failed: {}", e);
            }
            anyhow::bail!("Replicate status: {}", pred.status);
        }
        let output = pred
            .output
            .ok_or_else(|| anyhow::anyhow!("no output"))?;
        for u in output_to_urls(&output) {
            let bytes = client
                .get(&u)
                .send()
                .await?
                .error_for_status()?
                .bytes()
                .await?
                .to_vec();
            out.push(GenOutput {
                bytes,
                mime: "image/png".into(),
                seed: p.seed,
                model: model.into(),
            });
        }
    }
    Ok(out)
}

fn output_to_urls(v: &serde_json::Value) -> Vec<String> {
    if let Some(s) = v.as_str() {
        return vec![s.to_string()];
    }
    if let Some(arr) = v.as_array() {
        return arr
            .iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect();
    }
    vec![]
}

#[derive(Deserialize)]
struct CollectionResp {
    models: Vec<CollectionModel>,
}

#[derive(Deserialize)]
struct CollectionModel {
    owner: String,
    name: String,
    description: Option<String>,
}

pub async fn list_models(api_key: Option<&str>) -> anyhow::Result<Vec<ModelInfo>> {
    // Curated fallback if no key or the collection call fails.
    let fallback = || {
        vec![
            ModelInfo {
                id: "black-forest-labs/flux-1.1-pro".into(),
                label: "Flux 1.1 Pro".into(),
            },
            ModelInfo {
                id: "black-forest-labs/flux-schnell".into(),
                label: "Flux Schnell".into(),
            },
            ModelInfo {
                id: "stability-ai/stable-diffusion-3.5-large".into(),
                label: "SD 3.5 Large".into(),
            },
            ModelInfo {
                id: "recraft-ai/recraft-v3".into(),
                label: "Recraft v3".into(),
            },
            ModelInfo {
                id: "ideogram-ai/ideogram-v2".into(),
                label: "Ideogram v2".into(),
            },
        ]
    };
    let Some(key) = api_key else {
        return Ok(fallback());
    };
    let resp = http_client()
        .get("https://api.replicate.com/v1/collections/text-to-image")
        .bearer_auth(key)
        .send()
        .await;
    let r: CollectionResp = match resp {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(_) => return Ok(fallback()),
        },
        _ => return Ok(fallback()),
    };
    let mut out: Vec<ModelInfo> = r
        .models
        .into_iter()
        .map(|m| ModelInfo {
            id: format!("{}/{}", m.owner, m.name),
            label: m
                .description
                .filter(|d| !d.is_empty())
                .map(|d| {
                    let short: String = d.chars().take(60).collect();
                    format!("{} — {}", m.name, short)
                })
                .unwrap_or_else(|| format!("{}/{}", m.owner, m.name)),
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}
