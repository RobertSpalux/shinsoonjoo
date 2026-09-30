#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
커밋 전 비밀·개인정보 검사 — gitleaks 가 없는 PC 에서도 도는 대역(.githooks/pre-commit 가 부른다).

    python scripts/secret_scan.py --staged      # 스테이징된 추가 줄 + 파일명
    python scripts/secret_scan.py <파일>...      # 파일 통째

걸리면 exit 1 + (파일:줄 · 종류). **값은 출력하지 않는다.**
정본은 gitleaks(.gitleaks.toml · CI). 이 스크립트는 같은 종류를 정규식 몇 개로 미리 거르는 그물이다.

왜: 2026-09-30 저장소 비밀 감사 — 키·토큰·고객정보 0건이었지만 사람이 조심해서 0건이었다. 기계가 막게 한다.
"""
import fnmatch
import os
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# 종류 → 정규식. 자리표시(your_…, xxxx, ${…}, process.env …)는 PLACEHOLDER 로 뺀다.
RULES = {
    "JWT(Supabase 키류)": re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    "Anthropic 키": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "sk- 키": re.compile(r"\bsk-[A-Za-z0-9]{32,}"),
    "GitHub 토큰": re.compile(r"\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}"),
    "AWS 액세스 키": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "Google API 키": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "텔레그램 봇 토큰": re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b"),
    "Supabase sb_ 키": re.compile(r"\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}"),
    "개인키 블록": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "주민등록번호 꼴": re.compile(r"(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-[1-4]\d{6}(?!\d)"),
}
PLACEHOLDER = re.compile(r"(?i)your[_-]|example|placeholder|x{4,}|<[^>]+>|\$\{|process\.env|여기에|changeme|dummy")

# 저장소에 두지 않는 파일 — .gitignore 와 같은 목록(무시 규칙을 -f 로 뚫고 올리는 것을 막는다).
BLOCKED_NAMES = [
    (".env", "환경변수 파일"), (".env.*", "환경변수 파일"), ("*.pem", "개인키"), ("*.key", "개인키"), ("id_rsa*", "개인키"),
    ("_dump_*", "분석 프로그램 덤프(고객 계약 실데이터)"), ("*backup*.json", "분석 프로그램 백업(고객 계약 실데이터)"),
    ("soonjoo_profile.json", "인물 원장"), ("interview_20q.md", "인터뷰 원문"),
]
ALLOWED_NAMES = {".env.example", ".env.sample"}
SKIP_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".zip", ".pdf", ".hwp", ".hwpx", ".mp4")


def scan_text(text):
    """→ [(줄 번호, 종류)]. 값은 돌려주지 않는다."""
    out = []
    for n, line in enumerate((text or "").splitlines(), 1):
        for kind, rx in RULES.items():
            m = rx.search(line)
            if m and not PLACEHOLDER.search(line[max(0, m.start() - 40): m.end() + 20]):
                out.append((n, kind))
    return out


def blocked_name(path):
    """→ 막는 이유 | None."""
    base = os.path.basename(path.replace("\\", "/"))
    if base in ALLOWED_NAMES:
        return None
    for pat, why in BLOCKED_NAMES:
        if fnmatch.fnmatch(base, pat):
            return why
    if fnmatch.fnmatch(path.replace("\\", "/"), "compliance/evidence/*.zip"):
        return "증빙 압축본(키트가 다시 만든다 — PDF·HWP 원문만 둔다)"
    return None


def parse_added(diff):
    """`git diff --cached -U0` → {파일: [(줄 번호, 추가된 줄)]}"""
    out, cur, n = {}, None, 0
    for line in diff.splitlines():
        if line.startswith("+++ "):
            cur = None if line.endswith("/dev/null") else line[4:].removeprefix("b/")
        elif line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            n = int(m.group(1)) if m else 0
        elif line.startswith("+") and not line.startswith("+++") and cur:
            out.setdefault(cur, []).append((n, line[1:]))
            n += 1
    return out


def check_staged():
    git = lambda *a: subprocess.run(["git", "-c", "core.quotepath=false", *a], capture_output=True).stdout.decode("utf-8", "replace")
    hits = []
    for path in git("diff", "--cached", "--name-only", "--diff-filter=ACMR").splitlines():
        why = blocked_name(path)
        if why:
            hits.append((path, 0, "두지 않는 파일 — " + why))
    for path, lines in parse_added(git("diff", "--cached", "-U0", "--diff-filter=ACMR")).items():
        if path.lower().endswith(SKIP_EXT):
            continue
        for n, text in lines:
            hits += [(path, n, kind) for _, kind in scan_text(text)]
    return hits


def check_files(paths):
    hits = []
    for p in paths:
        why = blocked_name(p)
        if why:
            hits.append((p, 0, "두지 않는 파일 — " + why))
        if p.lower().endswith(SKIP_EXT) or not os.path.isfile(p):
            continue
        try:
            text = open(p, encoding="utf-8").read()
        except UnicodeDecodeError:
            continue
        hits += [(p, n, kind) for n, kind in scan_text(text)]
    return hits


def main():
    args = sys.argv[1:]
    hits = check_staged() if "--staged" in args or not args else check_files(args)
    if not hits:
        print("비밀 검사 통과")
        return 0
    print("⛔ 커밋 막음 — 비밀·개인정보로 보이는 것이 있습니다(값은 표시하지 않습니다):")
    for path, n, kind in hits:
        print(f"  · {path}{':' + str(n) if n else ''} — {kind}")
    print("오탐이면 그 줄을 자리표시(your_… · process.env…)로 바꾸거나, 정말 필요하면 git commit --no-verify 대신 로버트에게 먼저 묻는다.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
