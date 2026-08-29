#!/bin/sh
set -eu

release_tag=${1:-}
platform=${2:-}
output_dir=${3:-}

printf '%s\n' "$release_tag" | grep -Eq \
  '^release-(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || {
  echo "release tag must be release-MAJOR.MINOR.PATCH" >&2
  exit 64
}

case "$platform" in
  linux-x64)
    expected_kernel=Linux
    asset="svw-${release_tag}-linux-x64.tar.gz"
    ;;
  macos-arm64)
    expected_kernel=Darwin
    asset="svw-${release_tag}-macos-arm64.tar.gz"
    ;;
  *) echo "unsupported platform: $platform" >&2; exit 64 ;;
esac

[ -n "$output_dir" ] || { echo "output directory is required" >&2; exit 64; }
[ "$(uname -s)" = "$expected_kernel" ] || {
  echo "$platform must be verified on $expected_kernel" >&2
  exit 1
}

repo=${SVW_REPOSITORY:-svcomplex-dev/svw}
base_url=${SVW_RELEASE_BASE_URL:-https://github.com/${repo}/releases/download}
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/dsh-svw-import.XXXXXX")
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT HUP INT TERM

archive="$tmp_dir/$asset"
sidecar="$archive.sha256"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  --retry 3 --output "$archive" "${base_url%/}/${release_tag}/${asset}"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  --retry 3 --output "$sidecar" "${base_url%/}/${release_tag}/${asset}.sha256"

expected_sha=$(awk 'NR == 1 { print tolower($1) }' "$sidecar")
expected_name=$(awk 'NR == 1 { print $2 }' "$sidecar")
case "$expected_sha" in *[!0-9a-f]*|'') echo "invalid SHA256 sidecar" >&2; exit 1;; esac
[ "${#expected_sha}" -eq 64 ] || { echo "invalid SHA256 length" >&2; exit 1; }
[ "$expected_name" = "$asset" ] || { echo "checksum names an unexpected asset" >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha=$(sha256sum "$archive" | awk '{ print $1 }')
else
  actual_sha=$(shasum -a 256 "$archive" | awk '{ print $1 }')
fi
[ "$actual_sha" = "$expected_sha" ] || { echo "archive SHA256 mismatch" >&2; exit 1; }
if [ -n "${SVW_EXPECTED_ARCHIVE_SHA256:-}" ]; then
  [ "$actual_sha" = "$SVW_EXPECTED_ARCHIVE_SHA256" ] || {
    echo "archive differs from the repository-pinned SHA256" >&2
    exit 1
  }
fi

tar -tzf "$archive" >/dev/null
tar -tzf "$archive" | awk '
  /^\// { exit 1 }
  {
    count = split($0, component, "/")
    for (i = 1; i <= count; i++) if (component[i] == "..") exit 1
  }
' || { echo "archive contains an unsafe path" >&2; exit 1; }

member() {
  wanted=$1
  tar -tzf "$archive" | awk -v wanted="$wanted" '
    { normalized = $0; sub(/^\.\//, "", normalized) }
    normalized == wanted { found += 1; value = $0 }
    END { if (found == 1) print value; else exit 1 }
  '
}

extract_regular() {
  wanted=$1
  destination=$2
  archive_member=$(member "$wanted") || {
    echo "archive must contain exactly one $wanted" >&2
    exit 1
  }
  kind=$(tar -tvzf "$archive" "$archive_member" | awk 'NR == 1 { print substr($1, 1, 1) }')
  [ "$kind" = "-" ] || { echo "$wanted must be a regular file" >&2; exit 1; }
  mkdir -p "$(dirname "$destination")"
  tar -xOzf "$archive" "$archive_member" > "$destination"
}

if [ -d "$output_dir" ] && [ -n "$(find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "output directory must be absent or empty: $output_dir" >&2
  exit 1
fi
mkdir -p "$output_dir/bin"
extract_regular bin/svw "$output_dir/bin/svw"
chmod 0755 "$output_dir/bin/svw"
extract_regular share/svw/samples/tutorial_demo.vcd "$tmp_dir/tutorial_demo.vcd"

if command -v sha256sum >/dev/null 2>&1; then
  binary_sha=$(sha256sum "$output_dir/bin/svw" | awk '{ print $1 }')
else
  binary_sha=$(shasum -a 256 "$output_dir/bin/svw" | awk '{ print $1 }')
fi
printf '%s\n' "$actual_sha" > "$output_dir/archive.sha256"
printf '%s\n' "$binary_sha" > "$output_dir/binary.sha256"
printf '%s\n' "$asset" > "$output_dir/asset-name.txt"

"$output_dir/bin/svw" --version
"$output_dir/bin/svw" agent "$tmp_dir/tutorial_demo.vcd" info > "$tmp_dir/info.json"
"$output_dir/bin/svw" agent "$tmp_dir/tutorial_demo.vcd" render 0 100 top.clk \
  --width 80 --height 14 --color ansi --view wave > "$tmp_dir/frame.txt"
[ "$(wc -l < "$tmp_dir/frame.txt" | tr -d ' ')" -eq 5 ] || {
  echo "svw render smoke returned an unexpected row count" >&2
  exit 1
}

mkdir -p "$output_dir/integration/skills/svw-waveform"
extract_regular share/svw/agents/dsh-extension/index.js "$output_dir/integration/index.js"
extract_regular share/svw/agents/dsh-extension/client.cjs "$output_dir/integration/client.cjs"
extract_regular share/svw/agents/skills/svw-waveform/SKILL.md \
  "$output_dir/integration/skills/svw-waveform/SKILL.md"

case "$platform" in
  linux-x64)
    command -v readelf >/dev/null 2>&1 || {
      echo "readelf is required to audit the Linux executable" >&2
      exit 1
    }
    elf_header="$tmp_dir/elf-header.txt"
    elf_program_headers="$tmp_dir/elf-program-headers.txt"
    elf_dynamic="$tmp_dir/elf-dynamic.txt"
    readelf -hW "$output_dir/bin/svw" > "$elf_header"
    grep -Eq 'Class:[[:space:]]+ELF64' "$elf_header" &&
      grep -Eq 'Type:[[:space:]]+(EXEC|DYN)' "$elf_header" &&
      grep -Eq 'Machine:[[:space:]]+Advanced Micro Devices X86-64' "$elf_header" || {
      echo "Linux binary is not an x86-64 ELF executable" >&2
      exit 1
    }
    readelf -lW "$output_dir/bin/svw" > "$elf_program_headers"
    readelf -dW "$output_dir/bin/svw" > "$elf_dynamic"
    if grep -Fq '(NEEDED)' "$elf_dynamic"; then
      ldd "$output_dir/bin/svw" > "$output_dir/dynamic-libraries.txt"
      ! grep -q "not found" "$output_dir/dynamic-libraries.txt"
      ! grep -Eiq 'libstdc\+\+|libc\+\+|libc\+\+abi|libunwind|libz3|libfmt|libmimalloc' \
        "$output_dir/dynamic-libraries.txt"
      awk '
        /=> \// {
          path = $3
          if (path !~ /^\/lib(32|64)?\// && path !~ /^\/usr\/lib(32|64)?\//) exit 1
        }
        /^\// {
          path = $1
          if (path !~ /^\/lib(32|64)?\// && path !~ /^\/usr\/lib(32|64)?\//) exit 1
        }
      ' "$output_dir/dynamic-libraries.txt" || {
        echo "Linux binary has a non-system dynamic dependency" >&2
        exit 1
      }
    else
      ! grep -Eq '^[[:space:]]*INTERP[[:space:]]' "$elf_program_headers" || {
        echo "Linux binary has an interpreter but no declared dependencies" >&2
        exit 1
      }
      printf '%s\n' 'statically linked (no PT_INTERP or DT_NEEDED)' \
        > "$output_dir/dynamic-libraries.txt"
    fi
    ;;
  macos-arm64)
    lipo -archs "$output_dir/bin/svw" | grep -Eq '(^|[[:space:]])arm64($|[[:space:]])'
    otool -L "$output_dir/bin/svw" > "$output_dir/dynamic-libraries.txt"
    tail -n +2 "$output_dir/dynamic-libraries.txt" | awk '
      {
        path = $1
        if (path !~ /^\/usr\/lib\// && path !~ /^\/System\/Library\//) exit 1
      }
    ' || { echo "macOS binary has a non-system dynamic dependency" >&2; exit 1; }
    minos=$(otool -l "$output_dir/bin/svw" | awk '
      $1 == "cmd" && ($2 == "LC_BUILD_VERSION" || $2 == "LC_VERSION_MIN_MACOSX") { active = 1; next }
      active && ($1 == "minos" || $1 == "version") { print $2; exit }
    ')
    [ -n "$minos" ] || { echo "macOS deployment target is missing" >&2; exit 1; }
    case "$minos" in
      11|11.0|11.0.0) ;;
      *) echo "macOS deployment target must be 11.0, got $minos" >&2; exit 1 ;;
    esac
    ;;
esac

printf 'verified %s from %s (%s)\n' "$platform" "$asset" "$actual_sha"
