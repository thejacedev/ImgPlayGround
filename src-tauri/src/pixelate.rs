use image::{imageops::FilterType, GenericImageView, ImageFormat};
use std::path::PathBuf;

/// Downscale `src` to a `target_size`-pixel-on-its-longest-edge version using
/// nearest-neighbor. If `upscale_back` is true, also nearest-neighbor scale
/// back to the original dimensions so the output keeps the original canvas
/// size but reads as a blocky pixel-art piece.
///
/// Runs the actual decode/resize/encode on a blocking thread so it doesn't
/// stall the Tauri async runtime — image decoding is CPU-bound.
pub async fn pixelate_file(
    src: PathBuf,
    dest: PathBuf,
    target_size: u32,
    upscale_back: bool,
) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let img = image::open(&src)?;
        let (w, h) = img.dimensions();
        let target = target_size.max(2);
        let max_dim = w.max(h) as f32;
        let scale = (target as f32) / max_dim;
        let new_w = ((w as f32) * scale).round().max(1.0) as u32;
        let new_h = ((h as f32) * scale).round().max(1.0) as u32;
        let small = img.resize_exact(new_w, new_h, FilterType::Nearest);
        let out = if upscale_back {
            small.resize_exact(w, h, FilterType::Nearest)
        } else {
            small
        };
        out.save_with_format(&dest, ImageFormat::Png)?;
        Ok(())
    })
    .await??;
    Ok(())
}
