#!/usr/bin/env bash
set -euo pipefail

INSTALL_URL="${OPENCLAW_INSTALL_URL:-https://openclaw.bot/install.sh}"
DEFAULT_PACKAGE="openclaw"
PACKAGE_NAME="${OPENCLAW_INSTALL_PACKAGE:-$DEFAULT_PACKAGE}"

resolve_fallback_url() {
  local url="$1"
  if [[ "$url" == https://openclaw.ai/* ]]; then
    printf '%s\n' "https://openclaw.bot/${url#https://openclaw.ai/}"
    return 0
  fi
  if [[ "$url" == https://openclaw.bot/* ]]; then
    printf '%s\n' "https://openclaw.ai/${url#https://openclaw.bot/}"
    return 0
  fi
  return 1
}

download_with_retry_and_fallback() {
  local primary_url="$1"
  local output_path="$2"
  local -a candidates=("$primary_url")
  local fallback_url=""
  if fallback_url="$(resolve_fallback_url "$primary_url")"; then
    candidates+=("$fallback_url")
  fi
  local candidate=""
  for candidate in "${candidates[@]}"; do
    echo "==> Download installer: $candidate"
    if curl --retry 4 --retry-all-errors --retry-delay 2 -fsSL "$candidate" -o "$output_path"; then
      return 0
    fi
    echo "WARN: failed to download from $candidate"
  done
  return 1
}

echo "==> Pre-flight: ensure git absent"
if command -v git >/dev/null; then
  echo "git is present unexpectedly" >&2
  exit 1
fi

echo "==> Run installer (non-root user)"
INSTALL_SCRIPT="$(mktemp)"
if ! download_with_retry_and_fallback "$INSTALL_URL" "$INSTALL_SCRIPT"; then
  echo "ERROR: unable to download installer script from primary/fallback URLs" >&2
  exit 1
fi
bash "$INSTALL_SCRIPT"

# Ensure PATH picks up user npm prefix
export PATH="$HOME/.npm-global/bin:$PATH"

echo "==> Verify git installed"
command -v git >/dev/null

EXPECTED_VERSION="${OPENCLAW_INSTALL_EXPECT_VERSION:-}"
if [[ -n "$EXPECTED_VERSION" ]]; then
  LATEST_VERSION="$EXPECTED_VERSION"
else
  LATEST_VERSION="$(npm view "$PACKAGE_NAME" version)"
fi
CLI_NAME="$PACKAGE_NAME"
CMD_PATH="$(command -v "$CLI_NAME" || true)"
if [[ -z "$CMD_PATH" && -x "$HOME/.npm-global/bin/$PACKAGE_NAME" ]]; then
  CLI_NAME="$PACKAGE_NAME"
  CMD_PATH="$HOME/.npm-global/bin/$PACKAGE_NAME"
fi
if [[ -z "$CMD_PATH" ]]; then
  echo "$PACKAGE_NAME is not on PATH" >&2
  exit 1
fi
echo "==> Verify CLI installed: $CLI_NAME"
INSTALLED_VERSION="$("$CMD_PATH" --version 2>/dev/null | head -n 1 | tr -d '\r')"

echo "cli=$CLI_NAME installed=$INSTALLED_VERSION expected=$LATEST_VERSION"
if [[ "$INSTALLED_VERSION" != "$LATEST_VERSION" ]]; then
  echo "ERROR: expected ${CLI_NAME}@${LATEST_VERSION}, got ${CLI_NAME}@${INSTALLED_VERSION}" >&2
  exit 1
fi

echo "==> Sanity: CLI runs"
"$CMD_PATH" --help >/dev/null

echo "OK"
