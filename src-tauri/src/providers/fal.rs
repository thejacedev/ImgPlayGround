use super::{http_client, GenOutput, GenParams, ModelInfo};
use serde::Deserialize;

#[derive(Deserialize)]
struct Resp {
    images: Vec<FalImage>,
    seed: Option<u64>,
}

#[derive(Deserialize)]
struct FalImage {
    url: String,
}

pub async fn generate(api_key: &str, p: &GenParams) -> anyhow::Result<Vec<GenOutput>> {
    let model = p.model.as_deref().unwrap_or("fal-ai/flux-pro/v1.1");
    let url = format!("https://fal.run/{}", model);
    let image_size = image_size_from(&p.size);
    let mut body = serde_json::json!({
        "prompt": p.prompt,
        "image_size": image_size,
        "num_images": p.n,
    });
    if let Some(seed) = p.seed {
        body["seed"] = serde_json::json!(seed);
    }
    let client = http_client();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Key {}", api_key))
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Fal {}: {}", status, text);
    }
    let r: Resp = resp.json().await?;
    let mut out = Vec::new();
    for img in r.images {
        let bytes = client
            .get(&img.url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?
            .to_vec();
        out.push(GenOutput {
            bytes,
            mime: "image/png".into(),
            seed: r.seed,
            model: model.into(),
        });
    }
    Ok(out)
}

fn image_size_from(size: &str) -> &'static str {
    match size {
        "1024x1024" | "1:1" => "square_hd",
        "1344x768" | "16:9" => "landscape_16_9",
        "768x1344" | "9:16" => "portrait_16_9",
        "1152x896" | "4:3" => "landscape_4_3",
        "896x1152" | "3:4" => "portrait_4_3",
        _ => "square_hd",
    }
}

pub fn list_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id: "fal-ai/flux-pro/v1.1".into(),
            label: "Flux 1.1 Pro".into(),
        },
        ModelInfo {
            id: "fal-ai/flux-pro/v1.1-ultra".into(),
            label: "Flux 1.1 Pro Ultra".into(),
        },
        ModelInfo {
            id: "fal-ai/flux-pro/new".into(),
            label: "Flux Pro".into(),
        },
        ModelInfo {
            id: "fal-ai/flux/dev".into(),
            label: "Flux Dev".into(),
        },
        ModelInfo {
            id: "fal-ai/flux/schnell".into(),
            label: "Flux Schnell".into(),
        },
        ModelInfo {
            id: "fal-ai/recraft-v3".into(),
            label: "Recraft v3".into(),
        },
        ModelInfo {
            id: "fal-ai/ideogram/v2".into(),
            label: "Ideogram v2".into(),
        },
    ]
}
