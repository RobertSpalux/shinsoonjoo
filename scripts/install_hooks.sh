#!/bin/sh
# 이 저장소의 git 훅(.githooks/)을 켠다 — PC 마다 한 번.
#   sh scripts/install_hooks.sh
# 끄기: git config --unset core.hooksPath
cd "$(git rev-parse --show-toplevel)" || exit 1
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit 2>/dev/null
echo "훅 켬 — core.hooksPath=$(git config core.hooksPath)"
command -v gitleaks >/dev/null 2>&1 || echo "gitleaks 없음 — scripts/secret_scan.py 만으로 거른다(설치는 선택: https://github.com/gitleaks/gitleaks)"
