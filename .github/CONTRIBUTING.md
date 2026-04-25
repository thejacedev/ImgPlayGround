# Contributing

Pull requests welcome. Here's how to make one that lands.

## Before you start

For anything bigger than a typo / one-file fix, **open an issue first** — saves
you from rebuilding a feature that's headed somewhere else, or shipping a
design choice that conflicts with `.impeccable.md`.

## Setup

```bash
sudo dnf install -y webkit2gtk4.1-devel glib2-devel gtk3-devel libsoup3-devel \
                    openssl-devel libappindicator-gtk3-devel librsvg2-devel \
                    libsecret-devel gcc gcc-c++
git clone https://github.com/JaceDev/ImgPlayGround
cd ImgPlayGround
npm install
npm run app:dev
```

(Debian/Ubuntu equivalents in the README.)

## Conventions

**Frontend**

- Tokens only. No hard-coded hex / Tailwind color utilities (`bg-emerald-500`,
  etc.) in components. Use CSS variables defined in `src/styles.css`.
- Provider color: use `<ProviderDot>` / `<ProviderChip>` from
  `src/components/ProviderChip.tsx`. Never inline `var(--p-*)` in components.
- Status pills: use `<StatusChip>` from `src/components/StatusChip.tsx`.
- Loading buttons: use `<Spinner>` from `src/components/Spinner.tsx`.
- Headings on full-page views: use `<PageHeader num="0X" title="…" />`.
- Motion: respect `prefers-reduced-motion` (the global rule already does
  this — don't add `!important` overrides). Animate `transform` / `opacity`
  only, never layout properties.
- Accessibility: every input gets an `htmlFor`/`id` pair (or `sr-only`
  label). Every interactive element is keyboard-reachable.

**Backend (Rust)**

- New providers go in `src-tauri/src/providers/<name>.rs` and implement
  both `generate(api_key, GenParams) -> Vec<GenOutput>` and
  `list_models(api_key: Option<&str>) -> Vec<ModelInfo>`. Add the variant
  to the `Provider` enum and wire `from_str`.
- Never log API keys. They live in the OS keyring; treat them as sensitive
  end-to-end.
- File output goes through `storage::save_image` — don't write directly.

**Commits**

- One logical change per commit when reasonable.
- Imperative mood: "fix push token leak", not "fixed push token leak".
- No tool footers in commit messages.

## Tagging your PR

The release notes auto-bucket by label (see `.github/release.yml`). Tag
your PR with **one** of:

- `feature` / `enhancement` — new capability
- `fix` / `bug` — fixes broken behavior
- `design` / `ui` / `ux` — visual or interaction changes only
- `refactor` / `chore` / `build` — internals, no user-visible change
- `docs` — README / templates / etc.

## Adding a provider

See the README's "Adding a new provider" section. The TL;DR is one Rust
file, two enum entries, and a color hue. The UI picks it up automatically.

## Code of Conduct

This project follows the [Contributor Covenant](../CODE_OF_CONDUCT.md). Be
the kind of person you'd want to collaborate with.
