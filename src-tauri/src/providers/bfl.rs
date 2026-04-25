use super::{dims_from_size, http_client, GenOutput, GenParams, ModelInfo};
use serde::Deserialize;
use std::time::Duration;

#[derive(Deserialize)]
struct CreateResp {
    id: String,
    polling_url: Option<String>,
}

#[derive(Deserialize)]
struct ResultResp {
    status: String,
    result: Option<ResultInner>,
}

#[derive(Deserialize)]
struct ResultInner {
    sample: Option<String>,
}

pub async fn generate(api_key: &str, p: &GenParams) -> anyhow::Result<Vec<GenOutput>> {
    let model = p.model.as_deref().unwrap_or("flux-pro-1.1");
    let (w, h) = dims_from_size(&p.size);
    let client = http_client();
    let mut out = Vec::new();
    for _ in 0..p.n {
        let body = serde_json::json!({
            "prompt": p.prompt,
            "width": w,
            "height": h,
            "seed": p.seed,
            "output_format": "png",
        });
        let resp = client
            .post(format!("https://api.bfl.ai/v1/{}", model))
            .header("x-key", api_key)
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("BFL {}: {}", status, text);
        }
        let create: CreateResp = resp.json().await?;
        let poll_url = create
            .polling_url
            .unwrap_or_else(|| format!("https://api.bfl.ai/v1/get_result?id={}", create.id));

        let sample_url = loop {
            tokio::time::sleep(Duration::from_millis(1200)).await;
            let r: ResultResp = client
                .get(&poll_url)
                .header("x-key", api_key)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            match r.status.as_str() {
                "Ready" => {
                    if let Some(res) = r.result {
                        if let Some(s) = res.sample {
                            break s;
                        }
                    }
                    anyhow::bail!("BFL: no sample in result");
                }
                "Pending" | "Processing" | "Queued" => continue,
                other => anyhow::bail!("BFL status: {}", other),
            }
        };

        let bytes = client
            .get(&sample_url)
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
    Ok(out)
}

pub fn list_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id: "flux-pro-1.1".into(),
            label: "Flux 1.1 Pro".into(),
        },
        ModelInfo {
            id: "flux-pro-1.1-ultra".into(),
            label: "Flux 1.1 Pro Ultra".into(),
        },
        ModelInfo {
            id: "flux-pro".into(),
            label: "Flux Pro".into(),
        },
        ModelInfo {
            id: "flux-dev".into(),
            label: "Flux Dev".into(),
        },
    ]
}
