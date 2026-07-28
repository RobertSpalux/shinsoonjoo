#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
팜스 제출 전 기계 검증 — 사람이 눈으로 훑는 대신 스크립트가 전수 대조한다.

    python scripts/preflight.py <slug>

Supabase에서 기사를 읽어 6개 항목을 검사한다. 하나라도 실패하면 exit code 1.

⚠️ 단일 출처 원칙: 금지어·필수문구 목록을 이 파일에 하드코딩하지 않는다.
   - 금지어: src/lib/compliance/banned-terms.ts 의 term/정규식을 파싱해 사용.
   - 필수 유의문구: src/lib/brand.ts 의 REQUIRED_NOTICES 를 파싱해 사용.
   목록이 바뀌면 저 파일만 고치면 preflight도 자동으로 따라간다.

배경: 3호 팜스 반송(2026-07-27) — ① 출처 미명확 ② 약관 참조 유의문구.
   ① 출처는 stored content에서 직접 잡는다(check_sources).
   ② 유의문구는 원고에 저장되지 않고 렌더/익스포트 시 주입된다(본진=ArticleNotice,
      네이버·블로그스팟=osmu). 승인된 checklist-7도 stored content엔 유의문구가 없으므로
      본문 스캔은 오탐 → '딜리버리 경로가 살아있는가'를 검사한다(check_notice_wiring).

인증: 기존 .mjs 스크립트와 동일한 환경변수(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
      REST(PostgREST)로 읽는다. 새 인증 방식을 만들지 않는다.
"""
import os
import re
import sys
import json

import requests

# Windows 콘솔(CP949)에서도 한글·기호 출력이 깨지지 않게 UTF-8 강제.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND_TS = os.path.join(ROOT, "src", "lib", "brand.ts")
BANNED_TS = os.path.join(ROOT, "src", "lib", "compliance", "banned-terms.ts")
CONFIGS_DIR = os.path.join(ROOT, "configs")

# 인용 출처로 인정되는 공신력 기관 (§6.10 증빙 인정 기관). 금지어 목록이 아니므로 여기 소량 둔다.
INSTITUTIONS = [
    "금융감독원", "금감원", "금융위원회", "보건복지부", "국민건강보험공단", "건강보험공단",
    "국가암정보센터", "국세청", "통계청", "생명보험협회", "손해보험협회",
]

BODY_FIELDS = [
    ("본진", "main_website_markdown"),
    ("네이버", "naver_blog_content"),
    ("블로그스팟", "blogspot_content"),
]


# ────────────────────────────────────────────────
# env / Supabase
# ────────────────────────────────────────────────
def load_env():
    """os.environ 우선, 없으면 .env.local(BOM 안전) 폴백."""
    env = {}
    path = os.path.join(ROOT, ".env.local")
    if os.path.exists(path):
        # utf-8-sig: 첫 줄 BOM 제거(로컬 .env.local BOM 사고 회피)
        with open(path, encoding="utf-8-sig") as fp:
            for line in fp:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    # 실제 환경변수가 있으면 그것이 이긴다
    for k in ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


def fetch_article(slug):
    env = load_env()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("[env 오류] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 찾을 수 없습니다.")
    cols = ("slug,title,naver_title,blogspot_title,category,"
            "main_website_markdown,naver_blog_content,blogspot_content,verify_claims")
    r = requests.get(
        f"{url}/rest/v1/premium_articles",
        params={"slug": f"eq.{slug}", "select": cols, "limit": "1"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    if r.status_code != 200:
        sys.exit(f"[Supabase 오류] {r.status_code}: {r.text[:200]}")
    rows = r.json()
    if not rows:
        sys.exit(f"[기사 없음] slug='{slug}' 가 premium_articles에 없습니다.")
    return rows[0]


# ────────────────────────────────────────────────
# 단일 출처 파서 (brand.ts / banned-terms.ts)
# ────────────────────────────────────────────────
def parse_required_notices():
    ts = open(BRAND_TS, encoding="utf-8").read()
    m = re.search(r"export const REQUIRED_NOTICES\s*=\s*\[(.*?)\]\s*as const", ts, re.S)
    if not m:
        sys.exit("[파서 오류] brand.ts REQUIRED_NOTICES 를 찾지 못했습니다.")
    return re.findall(r'"([^"]+)"', m.group(1))


def _term_block(ts, name):
    m = re.search(name + r"[^=]*=\s*\[(.*?)\n\];", ts, re.S)
    return m.group(1) if m else ""


def parse_banned_terms():
    """banned-terms.ts에서 term/정규식을 등급별로 추출. A: A_TERMS / B: 나머지 단어 배열."""
    ts = open(BANNED_TS, encoding="utf-8").read()
    graded = {"A": [], "B": []}
    sources = [("A", "A_TERMS"), ("B", "B_TERMS"), ("B", "URGENCY"), ("B", "SLANDER"), ("B", "TITLE_MONEY")]
    for grade, name in sources:
        block = _term_block(ts, "const " + name)
        # 각 엔트리: { term: "...", re: /PATTERN/FLAGS, ... }
        for entry in re.finditer(r'term:\s*"([^"]+)"\s*,\s*re:\s*/(.+?)/([a-z]*)', block):
            term, pattern = entry.group(1), entry.group(2)
            try:
                rx = re.compile(pattern)  # JS→Python: 단순 lookahead·\d 등은 호환
            except re.error:
                rx = re.compile(re.escape(term))  # 비호환 패턴은 term 그대로 substring
            graded[grade].append((term, rx))
    if not graded["A"]:
        sys.exit("[파서 오류] banned-terms.ts A_TERMS 를 찾지 못했습니다.")
    return graded


# ────────────────────────────────────────────────
# 검사 항목
# ────────────────────────────────────────────────
def check_banned(article):
    graded = parse_banned_terms()
    title_fields = ["title", "naver_title", "blogspot_title"]
    all_fields = title_fields + [f for _, f in BODY_FIELDS]
    hits = {"A": [], "B": []}
    for grade, terms in graded.items():
        for field in all_fields:
            text = article.get(field) or ""
            for term, rx in terms:
                if rx.search(text):
                    hits[grade].append(f"{term}({field})")
    a, b = hits["A"], hits["B"]
    ok = len(a) == 0  # A등급만 하드 실패(생성 게이트와 동일 — B는 문맥 확인 경고)
    detail = f"A등급 {len(a)}, B등급 {len(b)}"
    if a:
        detail += f" · A: {', '.join(sorted(set(a)))}"
    if b:
        detail += f" · B(경고): {', '.join(sorted(set(b)))}"
    return ok, detail


def check_notice_wiring():
    """필수 유의문구 2종의 '딜리버리 경로'가 살아있는지 검사한다.
    ⚠️ 본문(stored content)을 스캔하지 않는다 — 유의문구는 원고에 저장되지 않고
       렌더/익스포트 시 주입되기 때문(본진=ArticleNotice, 네이버·블로그스팟=osmu).
       실측: 승인된 checklist-7(6088)도 stored content엔 유의문구가 없다 → 본문 스캔은 오탐.
    따라서 '경로가 끊겼는가'(누군가 참조를 제거)를 검사해야 실제 누락 회귀를 잡는다."""
    notices = parse_required_notices()
    problems = []
    if len([n for n in notices if n.strip()]) != 2:
        problems.append(f"REQUIRED_NOTICES 항목 {len(notices)}개(2개여야 함)")

    def refs(path, needle):
        try:
            return needle in open(os.path.join(ROOT, path), encoding="utf-8").read()
        except FileNotFoundError:
            return False

    wiring = [
        ("본진 ArticleView→ArticleNotice", "src/components/news/ArticleView.tsx", "ArticleNotice"),
        ("ArticleNotice→REQUIRED_NOTICES", "src/components/news/ArticleNotice.tsx", "REQUIRED_NOTICES"),
        ("osmu 바이럴 본문 주입", "src/lib/osmu-format.ts", "REQUIRED_NOTICES"),
        ("푸터", "src/components/Footer.tsx", "REQUIRED_NOTICES"),
    ]
    for label, path, needle in wiring:
        if not refs(path, needle):
            problems.append(f"{label} 끊김({path})")
    ok = not problems
    return ok, ("통과 — 필수 2종 딜리버리 경로 정상(ArticleNotice·osmu·푸터)"
                if ok else " / ".join(problems))


def check_sources(article):
    """외부 기관 인용 문장에 4요소(최소 연도 4자리) 존재 여부. 없으면 실패."""
    fails = []
    year_re = re.compile(r"(?:19|20)\d{2}")
    for label, field in BODY_FIELDS:
        text = article.get(field) or ""
        if not text:
            continue
        for line in text.splitlines():
            if any(inst in line for inst in INSTITUTIONS):
                if not year_re.search(line):
                    snippet = line.strip()[:40]
                    fails.append(f"{label}: 인용에 발행연도(4자리) 없음 — \"{snippet}…\"")
    ok = not fails
    return ok, ("통과 — 인용 문장에 연도 표기 확인" if ok else " / ".join(fails[:4]))


def check_writing_spec(article):
    md = article.get("main_website_markdown") or ""
    checks = {
        "알아두실 용어 표": "알아두실 용어" in md,
        "AI 요약 블록": "결론부터 말씀드리면" in md,
        "한 줄 조언": "<!-- advice -->" in md,
        "표": bool(re.search(r"\n\|.*\|.*\n\s*\|?\s*:?-{2,}", md)),
    }
    missing = [k for k, v in checks.items() if not v]
    ok = not missing
    return ok, ("통과" if ok else "누락: " + ", ".join(missing))


def check_length(article):
    md = article.get("main_website_markdown") or ""
    # 마크다운 제어문자 제거 후 글자 수(대략)
    plain = re.sub(r"[#>*`|]|-{2,}|\[[^\]]*\]\([^)]*\)|<!--.*?-->", "", md)
    plain = re.sub(r"\s+", "", plain)
    n = len(plain)
    ok = 2000 <= n <= 3200
    return ok, f"본진 {n}자" + ("" if ok else " — 범위(2,000~3,200자) 이탈")


def check_image_config(slug, article):
    exact = os.path.join(CONFIGS_DIR, f"{slug}.json")
    if os.path.exists(exact):
        return True, f"configs/{slug}.json"
    # DB slug ↔ 렌더 slug 불일치 대응(3호 사례): 공통 접두 매칭
    stem = slug[:12]
    if os.path.isdir(CONFIGS_DIR):
        for fn in os.listdir(CONFIGS_DIR):
            if fn.endswith(".json") and fn.startswith(stem):
                return True, f"configs/{fn} (⚠️ 인자 slug와 파일명 불일치 — 렌더 slug 확인)"
    return False, f"configs/{slug}.json 없음(이미지 config 유실 위험)"


# ────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        sys.exit("사용법: python scripts/preflight.py <slug>")
    slug = sys.argv[1]
    article = fetch_article(slug)

    results = [
        ("금지어 §6.10", *check_banned(article)),
        ("필수 유의문구", *check_notice_wiring()),
        ("출처 4요소", *check_sources(article)),
        ("WRITING-SPEC", *check_writing_spec(article)),
        ("분량", *check_length(article)),
        ("이미지 config", *check_image_config(slug, article)),
    ]

    print(f"\n── preflight: {slug} ──")
    all_ok = True
    for name, ok, detail in results:
        mark = "통과" if ok else "실패"
        print(f"  [{name:<12}] {mark} — {detail}")
        all_ok = all_ok and ok
    print()
    if not all_ok:
        print("결과: 실패 — 위 항목을 해소한 뒤 팜스 제출하세요.")
        sys.exit(1)
    print("결과: 통과 — 팜스 제출 가능.")


if __name__ == "__main__":
    main()
