# Repository rules

- Configure Git as `svcomplex-dev <code@svcomplex.ai>`. Every author,
  committer, and annotated tagger email must be `code@svcomplex.ai`.
- Run `npm run verify`, `sh test/git-hooks.sh`, `git diff --check`, and the
  relevant real-platform artifact smoke before pushing a change.
- SVW GitHub Release archives are the only binary source. Never compile SVW in
  this repository or modify a downloaded executable.
- Keep Linux x64 and macOS arm64 executables in separate npm packages. The
  entry package selects them through exact-version optional dependencies.
- Do not add install lifecycle scripts. Consumer installation must never run a
  compiler, curl, shell installer, or Homebrew mutation.
- Verify archive and binary SHA256 values, safe archive members, executable
  mode, real waveform rendering, and system-only dynamic dependencies before
  publication. macOS binaries must target macOS 11.0.
- Synchronize the host plugin, browser client, and skill only from the same
  verified SVW archive. `scripts/sync-svw-integration.mjs` must fail closed if
  its reviewed transform sites change.
- Do not advertise unsupported vendor waveform formats. Public plugin text and
  schemas are limited to VCD and FST until SVW policy explicitly changes.
- Publish platform packages before `dsh-svw-waveform`. Never overwrite an npm
  version; a source asset or hash change increments the plugin patch version.
