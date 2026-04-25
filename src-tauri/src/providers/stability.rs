use super::{aspect_from_size, http_client, GenOutput, GenParams, ModelInfo};
use reqwest::multipart::Form;

pub async fn generate(api_key: &str, p: &GenParams) -> anyhow::Result<Vec<GenOutput>> {
    let model = p.model.as_deref().unwrap_or("core");
    let endpoint = format!(
        "https://api.stability.ai/v2beta/stable-image/generate/{}",
        model
    );
    let aspect = aspect_from_size(&p.size);
    let client = http_client();
    let mut out = Vec::new();
    for _ in 0..p.n {
        let form = Form::new()
            .text("prompt", p.prompt.clone())
            .text("output_format", "png")
            .text("aspect_ratio", aspect.to_string());
        let resp = client
            .post(&endpoint)
            .bearer_auth(api_key)
            .header("accept", "image/*")
            .multipart(form)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Stability {}: {}", status, text);
        }
        let bytes = resp.bytes().await?.to_vec();
        out.push(GenOutput {
            bytes,
            mime: "image/png".into(),
            seed: None,
            model: model.into(),
        });
    }
    Ok(out)
}

pub fn list_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id: "core".into(),
            label: "Stable Image Core".into(),
        },
        ModelInfo {
            id: "ultra".into(),
            label: "Stable Image Ultra".into(),
        },
        ModelInfo {
            id: "sd3".into(),
            label: "Stable Diffusion 3".into(),
        },
    ]
}
