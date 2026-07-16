#!/bin/bash
# Installs the pi-statusline extension.
#
# Usage:
#   ./install.sh              # install to ~/.pi/agent/extensions (global)
#   ./install.sh --project    # install to ./.pi/extensions (current project only)
#   ./install.sh --uninstall  # remove a global install
#
# Remote usage (no clone needed):
#   curl -fsSL https://raw.githubusercontent.com/jordanjkelly12/pi-statusline/main/install.sh | bash

set -euo pipefail

REPO_RAW_URL="https://raw.githubusercontent.com/jordanjkelly12/pi-statusline/main/statusline.ts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || true)"

GLOBAL_DIR="$HOME/.pi/agent/extensions"
PROJECT_DIR="./.pi/extensions"

mode="global"
for arg in "$@"; do
	case "$arg" in
		--project) mode="project" ;;
		--uninstall) mode="uninstall" ;;
		-h|--help)
			sed -n '2,10p' "$0"
			exit 0
			;;
	esac
done

if [ "$mode" = "uninstall" ]; then
	if [ -f "$GLOBAL_DIR/statusline.ts" ]; then
		rm -f "$GLOBAL_DIR/statusline.ts"
		echo "Removed $GLOBAL_DIR/statusline.ts"
	else
		echo "Nothing to remove at $GLOBAL_DIR/statusline.ts"
	fi
	exit 0
fi

target_dir="$GLOBAL_DIR"
[ "$mode" = "project" ] && target_dir="$PROJECT_DIR"

mkdir -p "$target_dir"

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/statusline.ts" ]; then
	cp "$SCRIPT_DIR/statusline.ts" "$target_dir/statusline.ts"
else
	# Running via curl | bash — no local file, fetch from GitHub instead.
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$REPO_RAW_URL" -o "$target_dir/statusline.ts"
	elif command -v wget >/dev/null 2>&1; then
		wget -q "$REPO_RAW_URL" -O "$target_dir/statusline.ts"
	else
		echo "Error: need curl or wget to download statusline.ts" >&2
		exit 1
	fi
fi

echo "Installed statusline.ts -> $target_dir/statusline.ts"
echo "Run /reload in pi (or start a new session) to activate it."
