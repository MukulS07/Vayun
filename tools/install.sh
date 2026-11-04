#!/usr/bin/env bash
# One-line installer for Vayun on macOS and Linux:
#   curl -fsSL https://raw.githubusercontent.com/MukulS07/Vayun/master/tools/install.sh | bash
# Downloads the right installer for this computer from the latest GitHub Release.
set -euo pipefail

REPO="MukulS07/Vayun"
API="https://api.github.com/repos/$REPO/releases/latest"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null || die "curl is required"

# All asset download URLs of the latest release, one per line.
assets="$(curl -fsSL "$API" | grep -o '"browser_download_url": *"[^"]*"' | sed 's/.*"\(https[^"]*\)"/\1/')" \
  || die "could not read the latest release from GitHub"
pick() { printf '%s\n' "$assets" | grep -iE "$1" | head -n1 || true; }

case "$(uname -s)" in
  Darwin)
    if [ "$(uname -m)" = "arm64" ]; then url="$(pick 'arm64\.dmg$')"; else url="$(pick 'universal\.dmg$')"; fi
    [ -n "$url" ] || url="$(pick 'universal\.dmg$')"
    [ -n "$url" ] || die "no macOS installer found in the latest release"
    say "Downloading $(basename "$url")"
    curl -fL --progress-bar -o "$TMP/Vayun.dmg" "$url"
    say "Installing to /Applications"
    mount="$(hdiutil attach -nobrowse -readonly "$TMP/Vayun.dmg" | grep -o '/Volumes/.*' | head -n1)"
    [ -d "$mount/Vayun.app" ] || { hdiutil detach "$mount" -quiet || true; die "Vayun.app not found in the disk image"; }
    rm -rf /Applications/Vayun.app
    cp -R "$mount/Vayun.app" /Applications/
    hdiutil detach "$mount" -quiet || true
    # The build is not notarized by Apple; this lets it open without the "can't be opened" warning.
    xattr -cr /Applications/Vayun.app
    say "Done. Open Vayun from Launchpad or /Applications."
    ;;
  Linux)
    case "$(uname -m)" in
      x86_64|amd64) arch='x86_64|x64|amd64' ;;
      aarch64|arm64) arch='arm64|aarch64' ;;
      *) die "unsupported CPU: $(uname -m)" ;;
    esac
    url="$(pick "($arch).*\.AppImage\$")"
    [ -n "$url" ] || die "no Linux AppImage found in the latest release for this CPU"
    dest="$HOME/.local/share/vayun"; bin="$HOME/.local/bin"
    mkdir -p "$dest" "$bin"
    say "Downloading $(basename "$url")"
    curl -fL --progress-bar -o "$dest/Vayun.AppImage" "$url"
    chmod +x "$dest/Vayun.AppImage"
    ln -sf "$dest/Vayun.AppImage" "$bin/vayun"
    say "Done. Run 'vayun' (make sure $bin is on your PATH)."
    ;;
  *) die "this installer supports macOS and Linux; on Windows download Vayun-Setup-<version>.exe from the Releases page" ;;
esac
