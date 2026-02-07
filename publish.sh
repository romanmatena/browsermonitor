#!/bin/bash
set -e

# Publish browsermonitor to npm + GitHub
# Usage: ./publish.sh [patch|minor|major]
#   Default: patch

BUMP="${1:-patch}"
TOKEN_FILE="$HOME/.npm-token-browsermonitor"

# Check for npm token
if [ ! -f "$TOKEN_FILE" ]; then
  echo "Missing npm token file: $TOKEN_FILE"
  echo "Create it with: echo 'npm_YOUR_TOKEN' > $TOKEN_FILE && chmod 600 $TOKEN_FILE"
  exit 1
fi
NPM_TOKEN=$(cat "$TOKEN_FILE")

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: uncommitted changes. Commit first."
  exit 1
fi

# Bump version
OLD_VERSION=$(node -p "require('./package.json').version")
npm version "$BUMP" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "Version: $OLD_VERSION -> $NEW_VERSION"

# Commit and push to origin
git add package.json
git commit -m "v$NEW_VERSION"
git push origin master

# Push to GitHub
git push github master:main --force

# Publish to npm
npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN"
npm publish --access public
npm config delete //registry.npmjs.org/:_authToken

echo ""
echo "Published browsermonitor@$NEW_VERSION"
echo "  npm: https://www.npmjs.com/package/browsermonitor"
echo "  GitHub: https://github.com/romanmatena/browsermonitor"
