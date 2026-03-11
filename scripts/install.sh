#!/bin/sh
# Supervisor installer script
# Usage: curl -fsSL https://raw.githubusercontent.com/ParthJadhav/Supervisor/main/scripts/install.sh | sh

set -e

REPO="ParthJadhav/Supervisor"
APP_NAME="Supervisor"
INSTALL_DIR="/usr/local/bin"

# Cleanup on exit
CLEANUP_FILE=""
MOUNT_POINT=""
cleanup() {
  [ -n "$MOUNT_POINT" ] && hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  [ -n "$CLEANUP_FILE" ] && rm -f "$CLEANUP_FILE" 2>/dev/null || true
}
trap cleanup EXIT

# Colors (only if terminal supports it)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  NC=''
fi

info() { printf "${GREEN}[info]${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$1"; }
error() { printf "${RED}[error]${NC} %s\n" "$1" >&2; exit 1; }

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Darwin) OS="macos" ;;
  Linux)  OS="linux" ;;
  *)      error "Unsupported operating system: $OS. Use Windows manual download from GitHub Releases." ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="aarch64" ;;
  arm64)   ARCH="aarch64" ;;
  *)       error "Unsupported architecture: $ARCH" ;;
esac

# Check for curl
if ! command -v curl >/dev/null 2>&1; then
  error "curl is required but not installed. Install curl and try again."
fi

# Get latest release version
info "Fetching latest release..."
LATEST_RELEASE=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/')

if [ -z "$LATEST_RELEASE" ]; then
  error "Could not determine latest release. Check https://github.com/${REPO}/releases"
fi

# Basic semver validation
case "$LATEST_RELEASE" in
  [0-9]*.[0-9]*.[0-9]*) ;; # looks like semver
  *) error "Unexpected version format: $LATEST_RELEASE" ;;
esac

info "Latest version: ${LATEST_RELEASE}"

# Determine download artifact
if [ "$OS" = "macos" ]; then
  ARTIFACT="${APP_NAME}_${LATEST_RELEASE}_${ARCH}.dmg"
elif [ "$OS" = "linux" ]; then
  ARTIFACT="${APP_NAME}_${LATEST_RELEASE}_${ARCH}.AppImage"
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${LATEST_RELEASE}/${ARTIFACT}"

# Download
DL_TMPDIR="${TMPDIR:-/tmp}"
DOWNLOAD_PATH="${DL_TMPDIR}/${ARTIFACT}"
CLEANUP_FILE="$DOWNLOAD_PATH"

info "Downloading ${ARTIFACT}..."
curl -fSL "$DOWNLOAD_URL" -o "$DOWNLOAD_PATH" || error "Download failed. Check if the release exists at ${DOWNLOAD_URL}"

# Install
if [ "$OS" = "macos" ]; then
  info "Installing to /Applications..."

  # Mount DMG and extract mount point (handle paths with spaces)
  MOUNT_OUTPUT=$(hdiutil attach "$DOWNLOAD_PATH" -nobrowse -noautoopen)
  MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | tail -1 | sed 's/.*[[:space:]]\/Volumes/\/Volumes/')

  if [ -z "$MOUNT_POINT" ]; then
    error "Failed to mount DMG"
  fi

  # Copy app (with sudo fallback for managed machines)
  if [ -d "/Applications/${APP_NAME}.app" ]; then
    warn "Removing existing ${APP_NAME}.app..."
    rm -rf "/Applications/${APP_NAME}.app" 2>/dev/null || sudo rm -rf "/Applications/${APP_NAME}.app"
  fi

  if [ -w "/Applications" ]; then
    cp -R "${MOUNT_POINT}/${APP_NAME}.app" /Applications/
  else
    warn "Requesting sudo to install to /Applications..."
    sudo cp -R "${MOUNT_POINT}/${APP_NAME}.app" /Applications/
  fi

  # Unmount (also handled by cleanup trap on failure)
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  MOUNT_POINT=""

  info "Installed ${APP_NAME}.app to /Applications"

elif [ "$OS" = "linux" ]; then
  info "Installing to ${INSTALL_DIR}..."

  chmod +x "$DOWNLOAD_PATH"

  # Check if we need sudo
  if [ -w "$INSTALL_DIR" ]; then
    mv "$DOWNLOAD_PATH" "${INSTALL_DIR}/supervisor"
  else
    warn "Requesting sudo to install to ${INSTALL_DIR}..."
    sudo mv "$DOWNLOAD_PATH" "${INSTALL_DIR}/supervisor"
  fi

  # File was moved, remove from cleanup list
  CLEANUP_FILE=""

  info "Installed supervisor to ${INSTALL_DIR}/supervisor"
fi

printf "\n${GREEN}Successfully installed ${APP_NAME} v${LATEST_RELEASE}!${NC}\n"

if [ "$OS" = "macos" ]; then
  printf "Run it from Applications or: ${YELLOW}open -a ${APP_NAME}${NC}\n"
elif [ "$OS" = "linux" ]; then
  printf "Run it with: ${YELLOW}supervisor${NC}\n"
fi
