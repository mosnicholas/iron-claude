#!/bin/bash
#
# Migrate the claude/github-to-db-migration-KHB09 branch from this repo
# (mosnicholas/iron-claude) to a new private repo (mosnicholas/iron-claude-pro)
# as main.
#
# Run this from your LOCAL machine, NOT from inside the Claude Code container.
# You need real SSH credentials authorized to push to mosnicholas/iron-claude-pro.
#
# Pre-req: create the empty private repo at https://github.com/new first.
# See MIGRATION.md for the full step-by-step.

set -euo pipefail

OLD_URL="${OLD_URL:-git@github.com:mosnicholas/iron-claude.git}"
NEW_URL="${NEW_URL:-git@github.com:mosnicholas/iron-claude-pro.git}"
SOURCE_BRANCH="${SOURCE_BRANCH:-claude/github-to-db-migration-KHB09}"
TARGET_DIR="${TARGET_DIR:-../iron-claude-pro}"

echo "[migrate] Cloning ${SOURCE_BRANCH} from ${OLD_URL} into ${TARGET_DIR}"

if [ -d "$TARGET_DIR" ]; then
  echo "[migrate] $TARGET_DIR already exists. Refusing to overwrite. Move it aside and re-run."
  exit 1
fi

git clone --branch "$SOURCE_BRANCH" "$OLD_URL" "$TARGET_DIR"
cd "$TARGET_DIR"

echo "[migrate] Repointing origin → $NEW_URL"
git remote set-url origin "$NEW_URL"

echo "[migrate] Renaming branch to main"
git branch -m "$SOURCE_BRANCH" main

echo "[migrate] Pushing main → $NEW_URL"
git push -u origin main

echo ""
echo "[migrate] Done. Next steps (from MIGRATION.md):"
echo "  3. Configure GitHub Actions secrets on the new repo"
echo "  4. Rename + flip mosnicholas/iron-claude to public as iron-claude-git-backing"
echo "  5. Point Fly + Telegram at the new repo"
echo "  6. Verify CI + /health + Telegram round-trip"
