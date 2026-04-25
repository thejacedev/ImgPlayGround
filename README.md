<div align="center">

<img src="assets/og.png" alt="ImgPlayGround — six image APIs, one desk, zero tabs" />

A native desktop control room for AI image generation — runs OpenAI, Google
Imagen, Stability, Replicate, Fal, and Black Forest Labs side-by-side, dumps
results into folders you actually understand, and pushes them to your own
GitHub repo if you want.

[Install](#install) ·
[Quickstart](#quickstart) ·
[Prompt syntax](#prompt-syntax) ·
[Cutting a release](#cutting-a-release)

</div>

---

## Why

Every image-gen vendor wants you in their browser tab. Their gallery, their
file naming, their ephemeral history. You end up with seventeen open tabs and
zero idea where the good ones are.

ImgPlayGround inverts that. Your prompts run *here*, the outputs land *here*,
named the way *you* want, in folders *you* picked, optionally backed up to a
git repo *you* control. The vendors are interchangeable. You aren't.

## What it is

- **Native desktop app** — Tauri v2 (Rust + WebView). ~10MB installer, starts
  in ~200ms, no Electron tax.
- **Six providers, one queue** — OpenAI `gpt-image-2`, Google Imagen 4,
  Stability Core/Ultra/SD3, Replicate (Flux + others), Fal.ai (Flux variants),
  Black Forest Labs (Flux Pro 1.1 / Ultra). Bring your own API keys.
- **Bulk mode that actually scales** — paste N prompts, pick M providers,
  watch a live gauge fill in as each `prompt × provider` job lands.
- **Storage you can find later** — predictable paths, JSON sidecars with the
  prompt + model + seed, and a prompt syntax that lets you put images
  *exactly* where you want them.
- **Optional GitHub sync** — connect a token, pick or create a repo, every
  batch auto-commits and pushes. Token never touches `.git/config`.

## Install

### Fedora 38+

```bash
sudo dnf install -y webkit2gtk4.1-devel glib2-devel gtk3-devel libsoup3-devel \
                    openssl-devel libappindicator-gtk3-devel librsvg2-devel \
                    libsecret-devel gcc gcc-c++

git clone https://github.com/JaceDev/ImgPlayGround
cd ImgPlayGround
npm install
npm run app:dev
```

### Debian / Ubuntu

```bash
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
                    libssl-dev libayatana-appindicator3-dev librsvg2-dev \
                    libsecret-1-dev build-essential
```

### macOS / Windows

Once a release exists: download `.dmg` / `.msi` from
[Releases](../../releases) and double-click. Done.

To build from source you'll need Node 20+, Rust stable, and Xcode CLT (mac)
or MSVC Build Tools (win).

## Quickstart

1. Launch the app.
2. **Keys → paste your provider API keys.** Stored in your OS keyring
   (libsecret / Keychain / Credential Vault). Never on disk.
3. **Settings → pick an output directory.** This becomes your library root.
4. *(Optional)* **Settings → GitHub sync → Connect.** Use a classic token
   with the `repo` scope. Pick an existing repo or create a new one from
   inside the app.
5. **Generate** a single prompt, or **Bulk** an entire batch.
   - <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>↵</kbd> sends.

## Providers

| Provider | Default model | Notes |
|---|---|---|
| OpenAI | `gpt-image-2` | Live `/v1/models` lookup |
| Google Imagen | `imagen-4.0-generate-001` | Via Gemini API |
| Stability AI | `core` | `core` / `ultra` / `sd3` |
| Replicate | `black-forest-labs/flux-1.1-pro` | Curated `text-to-image` collection |
| Fal.ai | `fal-ai/flux-pro/v1.1` | Flux family + Recraft + Ideogram |
| Black Forest Labs | `flux-pro-1.1` | Flux Pro / Ultra / Dev |

The Model dropdown in **Generate** is populated dynamically per-provider —
hit ↻ to refresh. Free text still wins, so you can punch in any model the
provider exposes.

## Storage layout

By default, every image goes here:

```
{output}/generated/{provider}/{YYYY-MM-DD}/{slug-of-prompt}-{shorthash}.png
{output}/generated/{provider}/{YYYY-MM-DD}/{slug-of-prompt}-{shorthash}.png.json
```

The sidecar JSON has the full prompt, model, size, seed, and timestamp — so
you can find or re-run anything later.

## Prompt syntax

Power-user trick: append shape suffixes to redirect where the file lands.

| Suffix | Effect |
|---|---|
| `:name.png` | Save with that exact filename |
| `:tiles/grass/grass_32x32.png` | Save at `{output}/tiles/grass/grass_32x32.png` |
| `;tiles/grass` | Save under `{output}/tiles/grass/` (auto-named) |
| `;folder:name.png` | Folder + name as separate suffixes |

Examples:

```text
mossy stone wall:tiles/walls/wall_a.png
golden retriever astronaut:dogs/space.jpg
isometric cyberpunk diner;scenes
```

The provider only sees the cleaned prompt — the suffix is stripped before
the API call. `n > 1` with a custom name auto-numbers as `name-2.png`,
`name-3.png`. Path segments are sanitized (no `..`, no absolute paths).

Bulk inherits the same syntax — every line in your prompt list can have its
own destination.

## Gallery

- **Contact-sheet layout** — every 9th tile gets the 2×2 hero slot. Hover
  any tile and it glows in its provider's color.
- **Filter bar** matches prompt, provider, or path.
- **Select mode** lets you multi-pick and save anywhere with an optional
  subfolder — e.g. pick `~/Pictures`, type `sprites/grass`, drop 12 tiles
  into `~/Pictures/sprites/grass/`.

## GitHub sync

Connect once via Settings. Two token options:

| Token type | Scope | Can create repos? | Can push? |
|---|---|---|---|
| **Classic** ★ recommended | `repo` | ✅ | ✅ |
| Fine-grained | `Administration: R/W` + `Contents: R/W` on target repos | ✅ | ✅ |

[Create a classic token →](https://github.com/settings/tokens/new?scopes=repo&description=ImgPlayGround)

Tokens live in your OS keyring. The PAT is never written to `.git/config` —
each push assembles a tokenized URL on the fly and the token is scrubbed
from any error output.

## Cutting a release

CI auto-builds and publishes on every `v*` tag — Linux (`.AppImage` + `.rpm`
+ `.deb`), macOS Apple Silicon (`.dmg`), Windows (`.msi`).

```bash
# 1. Bump version in package.json, src-tauri/Cargo.toml,
#    src-tauri/tauri.conf.json. Commit.
# 2. Tag and push.
git tag v0.1.0
git push origin v0.1.0
```

Release notes are auto-generated by GitHub from PR titles since the previous
tag, bucketed by label per `.github/release.yml` (✨ Features, 🐛 Fixes,
🎨 Design / UX, 🛠 Internals, 📚 Docs).

## Linux + NVIDIA crash on launch

If the app insta-closes on Fedora / other distros with the proprietary NVIDIA
driver and `coredumpctl info` points at `libnvidia-eglcore.so`, that's a
known WebKitGTK + NVIDIA bug in the DMABuf renderer. v1.0.1+ ships with the
workaround baked into the binary (`WEBKIT_DISABLE_DMABUF_RENDERER=1` set at
startup on Linux only).

If you're stuck on v1.0.0, launch with the env vars manually:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  /usr/bin/imgplayground
```

## Auto-update

Installed builds quietly check the GitHub Releases API on launch. If a newer
version exists, a banner slides in at the bottom right with **Install** →
progress bar → **Restart**. Failures (no internet, no release yet) are
swallowed silently — never bothers users with infrastructure noise.

### One-time signing setup

The updater verifies bundles with a key pair. Run this **once** locally:

```bash
npm run tauri signer generate -- -w ~/.tauri/imgplayground.key
```

Then:

1. Copy the public key into `src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey` (replace the `REPLACE_WITH_OUTPUT_…` placeholder).
2. Add two **GitHub Actions secrets** (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/imgplayground.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you set at generation

From then on, every `v*` tag produces signed bundles + a `latest.json`
manifest attached to the release. Existing installs notice within seconds
of being opened.

> **Don't lose the private key.** Without it you can't ship updates to
> existing installs — they'll reject the new key's signature. Back it up
> to a password manager.

## Repo layout

```
.
├── src/                    React UI
│   ├── App.tsx
│   ├── components/         Rail · BottomBar · Generate · Bulk · Gallery · Keys · Settings
│   └── lib/                types · tauri (invoke wrappers) · store (zustand)
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          Tauri command surface
│   │   ├── providers/      One adapter per provider
│   │   ├── github.rs       GitHub API client + tokenized push helper
│   │   ├── storage.rs      Path layout + suffix parsing + sidecars
│   │   ├── git.rs          init / commit / set-remote / push
│   │   ├── keys.rs         OS keyring wrapper
│   │   └── config.rs       Persistent app settings
│   ├── capabilities/       Tauri v2 capabilities
│   ├── icons/              App + bundle icons
│   └── tauri.conf.json
├── .github/
│   ├── workflows/          CI + Release
│   └── release.yml         Auto-changelog bucketing
└── .impeccable.md          Design context for any future UI work
```

## Adding a new provider

1. `src-tauri/src/providers/<name>.rs` — implement `generate(api_key, GenParams) -> Vec<GenOutput>` and `list_models()`.
2. Add the variant to `Provider` in `providers/mod.rs` plus the `from_str` arm.
3. Add the string to `PROVIDERS`, `PROVIDER_LABELS`, `PROVIDER_DEFAULT_MODEL`, and `PROVIDER_COLORS` in `src/lib/types.ts`.
4. Pick a hue (`--p-<name>`) in `src/styles.css`.
5. Rebuild.

The UI picks up the new provider automatically — including in the bulk
matrix, the gallery glow, and the bottom-bar status dots.

## Tech

| | |
|---|---|
| Frontend | React 18 · TypeScript · Vite · Tailwind v3 · Zustand |
| Display fonts | Geist (UI) · Geist Mono (paths) · Fraunces (titles) |
| Backend | Rust · Tokio · `reqwest` (rustls) · `keyring` v3 |
| Shell | Tauri v2 |
| Bundles | AppImage · RPM · DEB · DMG (arm64 + x64) · MSI |

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) — versioned, follows [Keep a Changelog](https://keepachangelog.com/).

## License

MIT — see [LICENSE](./LICENSE).

## Credits

Built with help from the ridiculous lineup of open-source maintainers behind
Tauri, Vite, Tailwind, Zustand, Geist, Fraunces, the Rust ecosystem, and the
six provider SDKs that didn't have to expose this much surface but did anyway.
