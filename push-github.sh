#!/bin/bash
set -e

# Push current master to GitHub main
git push github master:main --force

echo "Pushed to https://github.com/romanmatena/browsermonitor"
