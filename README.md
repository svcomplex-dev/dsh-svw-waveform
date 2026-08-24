# dsh-svw-waveform

Native [SVW](https://github.com/svcomplex-dev/svw) waveform rendering for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The plugin registers `svw_wave_render`. The model supplies an exact VCD or FST
path, native tick range, and one to twelve hierarchical signal names. In the
DeepSeek Harness Web UI the result becomes an interactive waveform viewer with
zoom, pan, markers, radix selection, edge navigation, and delta-cycle markers.
Surfaces without the client plugin fall back to the complete ANSI terminal
waveform card.

## Install

Install the public npm bundle into the Web profile:

```sh
dsh plugin --profile web add dsh-svw-waveform
dsh --profile web --dump-config
dsh --profile web
```

The npm bundle selects a package-private SVW executable for Linux x64 or macOS
arm64. It does not compile on the consumer machine and has no `install`,
`postinstall`, or `prepare` script. Set `SVW_BIN=/absolute/path/to/svw` to use
an independently installed binary instead. On macOS, an existing Homebrew SVW
installation is also accepted as a fallback.

DeepSeek Harness is still a developer preview. This package currently supports
the `@deepseek-ai/dsh` 0.1.x release-candidate line and tests every change
against a pinned version before publication.

## Use

First obtain exact signal names:

```sh
svw agent design.vcd signals reset 20
```

Then ask the agent to display a bounded window, or call the registered tool
with arguments equivalent to:

```json
{
  "waveform": "design.vcd",
  "start": 100,
  "end": 160,
  "hier": ["top.clk", "top.reset_n"],
  "width": 120,
  "height": 24
}
```

The bundled `svw-waveform` skill teaches the agent the complete discovery,
value/change, render, comparison, semantic-design, UVM, and coverage workflows.

## Artifact provenance

SVW GitHub Releases are the only binary source. This repository never rebuilds
SVW. Its release workflow:

1. downloads the exact `release-X.Y.Z` Linux and macOS archives and SHA256
   sidecars;
2. rejects unsafe archive paths and extracts only declared regular files;
3. smoke-tests `svw --version`, waveform metadata, and a real render;
4. audits dynamic libraries on clean GitHub-hosted runners;
5. packages the byte-identical `bin/svw` files into platform-specific npm
   packages before publishing the entry bundle.

The platform packages are:

- `dsh-svw-waveform-linux-x64`
- `dsh-svw-waveform-darwin-arm64`

Each package includes `svw-provenance.json` with the source Release asset and
both archive and binary SHA256 values. Replacing an asset under the same SVW
tag creates a new immutable plugin patch version rather than overwriting an npm
version.

The host and browser integration are synchronized from the versioned
`share/svw/agents/dsh-extension` files inside the same verified SVW archive.
`svw-source.json` records their original hashes and the small downstream
packaging transforms.

## Publishing setup

The `publish.yml` workflow accepts either `repository_dispatch` event
`svw-release-published` or a manual `release-X.Y.Z` input. It supports a
temporary `NPM_TOKEN` for bootstrapping the three package names. After that,
configure npm Trusted Publishing for each package with:

- GitHub organization: `svcomplex-dev`
- repository: `dsh-svw-waveform`
- workflow filename: `publish.yml`
- allowed action: `npm publish`

Once all three trusted publishers work, remove `NPM_TOKEN`. The workflow uses
GitHub OIDC and publishes npm provenance automatically.

## Development

```sh
npm run verify
sh scripts/setup-git-hooks.sh
```

All commits and annotated package tags must use
`svcomplex-dev <code@svcomplex.ai>`.
