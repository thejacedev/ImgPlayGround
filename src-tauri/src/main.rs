#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK + NVIDIA driver workaround. The DMABuf-based renderer
    // segfaults inside libnvidia-eglcore on context teardown for some
    // versions of the proprietary NVIDIA driver, taking the WebKitWebProcess
    // (and the whole app) with it. Disabling DMABuf forces a software path
    // for buffer sharing, which is plenty fast for an image-gen UI.
    //
    // Compositing is also disabled as a belt-and-braces fallback — without
    // it, certain hardware-accelerated CSS effects (backdrop-filter blur,
    // transforms) degrade gracefully but the app stays alive.
    //
    // Both vars respect user overrides: if you've set them in your shell
    // already, we don't clobber.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    imgplayground_lib::run()
}
