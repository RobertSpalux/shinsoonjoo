#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
팜스 제출 전 기계 검증 — 사람이 눈으로 훑는 대신 스크립트가 전수 대조한다.

    python scripts/preflight.py <slug>

Supabase에서 기사를 읽어 9개 항목을 검사한다. 하나라도 실패하면 exit code 1.

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
SOURCES_JSON = os.path.join(CONFIGS_DIR, "sources.json")
QUOTED_TITLE = re.compile(r"「([^」]+)」")

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

CHANNEL_OF = {"main_website_markdown": "main",
              "naver_blog_content": "naver",
              "blogspot_content": "blogspot"}
# 동결 채널 — 발행하지 않으므로 심의도 받지 않는다(§6.9: 블로그스팟은 본진과 같은 구글 = 자기잠식).
# ad_reviews row가 영구히 생기지 않아 frozen_channels로는 걸러지지 않는다 → 별도 제외.
# 제출하지 않는 채널을 검사하면 영구 실패로 남아 게이트를 무시하게 만든다. 재개 시 이 집합에서 뺀다.
DORMANT_CHANNELS = {"blogspot"}
# 푸터가 커버하는 채널 — 사이트 안이므로 premiumVariation이 전 페이지 상시노출된다
# (Footer.tsx → CONDITIONAL_NOTICES.premiumVariation, 사이트 골격 6977호).
# 실측: 6088호(1호 본진)는 본문에 이 자구가 없이 승인됐다. 반면 네이버·블로그스팟은 사이트 밖이라
# 푸터가 없어 본문에 자구가 있어야 한다(1호 네이버 반송 사유 ④의 구조적 원인).
# → 렌더/익스포트로 주입되는 문구는 본문에서 찾지 않는다(check_notice_wiring과 동일 원칙).
FOOTER_COVERED = {"main"}
MANWON     = re.compile(r"[0-9][0-9,]*\s*만\s*원")
MANWON_DAE = re.compile(r"[0-9][0-9,]*\s*만\s*원\s*대")
ANY_MONEY  = re.compile(r"[0-9][0-9,]*\s*(?:만\s*원|억|원)")


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
    cols = ("id,slug,title,naver_title,blogspot_title,category,"
            "main_website_markdown,naver_blog_content,blogspot_content,verify_claims,"
            "ad_reviews(channel,status)")
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
    """인용 서지(발행연도)가 본문에 1회 이상 있는지 — 문서 단위.
    ⚠️ 줄 단위가 아니다. 첫 인용에 서지(기관·문서명·발행연도)를 넣고 이후 '같은 자료'로
       약칭하는 것이 정본 설계(§6.10). 줄마다 연도를 강요하면 서비스명("금융감독원이 운영하는
       파인")·귀속 문장까지 오탐한다. 따라서 기관을 언급한 본문이면 그 본문 어딘가에
       발행연도(4자리)가 1회 이상 있으면 통과한다."""
    year_re = re.compile(r"(?:19|20)\d{2}")
    fails = []
    for label, field in BODY_FIELDS:
        text = article.get(field) or ""
        if not text:
            continue
        if any(inst in text for inst in INSTITUTIONS) and not year_re.search(text):
            fails.append(f"{label}: 기관 인용이 있으나 본문에 발행연도(4자리) 서지가 없음")
    ok = not fails
    return ok, ("통과 — 인용 서지(발행연도) 본문 내 확인" if ok else " / ".join(fails))


def parse_source_titles():
    """자료명 정본 목록 — configs/sources.json 단일 출처.
    파일이 없으면 검사를 건너뛰지 않고 실패시킨다(있어야 하는 파일이다)."""
    if not os.path.exists(SOURCES_JSON):
        sys.exit(f"[출처 대장 없음] {SOURCES_JSON} — 자료명 정본 대장을 먼저 만들고 커밋하세요.")
    with open(SOURCES_JSON, encoding="utf-8") as fp:
        data = json.load(fp)
    return {s["title"] for s in data.get("sources", [])}


def check_source_titles(article):
    """본문 「」 안 자료명이 대장에 정확히 있는지 대조한다.
    축약·변형하면 대장에 없으므로 걸린다.
    근거: 2호 네이버 반송(2026-07-30) — 「계약 전 알릴의무 안내」로 축약해 반송."""
    titles = parse_source_titles()
    fails = []
    for label, text in pending_bodies(article):
        for m in QUOTED_TITLE.finditer(text):
            got = m.group(1).strip()
            if got not in titles:
                fails.append(f"{label}: 대장에 없는 자료명 — 「{got}」")
    ok = not fails
    return ok, ("통과 — 자료명 정본 대조 완료" if ok else
                " / ".join(fails) + "  → 원문 제목 확인 후 configs/sources.json에 등록하거나 본문을 원문 제목으로 고칠 것")


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


def frozen_channels(article):
    """심의 접수·승인된 채널 = 원안 수정 불가 → 제출 전 게이트의 검사 대상이 아니다.
    이 스코프가 없으면 승인분(6088·6964·8289·8290)이 영구 실패로 남아 노이즈가 된다."""
    rows = article.get("ad_reviews") or []
    return {r.get("channel") for r in rows if r.get("status") in ("approved", "submitted")}


def pending_bodies(article, exclude=frozenset()):
    skip = frozen_channels(article) | DORMANT_CHANNELS | set(exclude)
    out = []
    for label, field in BODY_FIELDS:
        if CHANNEL_OF.get(field) in skip:
            continue
        text = article.get(field) or ""
        if text:
            out.append((label, text))
    return out


def _units(text):
    """줄 단위로 자른 뒤 각 줄을 마침표로 다시 자른다.
    표·불릿은 마침표가 없어 줄이 유일한 경계이므로 두 단계가 모두 필요하다."""
    out = []
    for line in text.split("\n"):
        for s in re.split(r"(?<=\.)\s+", line):
            s = s.strip()
            if s:
                out.append(s)
    return out


def check_premium_notation(article):
    """보험료 표기 검사 — 참고자료 ⑭.
    보장금액의 만원 표기는 정상이므로 '보험료'와 같은 문장일 때만 잡는다."""
    fails = []
    for label, text in pending_bodies(article):
        premium_money = False
        for u in _units(text):
            if MANWON_DAE.search(u):
                fails.append(f"{label}: 'N만원대' 표기 — {u[:40]}")
                continue
            if "보험료" in u and MANWON.search(u):
                fails.append(f"{label}: 보험료 만원 반올림 — {u[:50]}")
            if "보험료" in u and ANY_MONEY.search(u):
                premium_money = True
        if premium_money and "산출기준" not in text:
            fails.append(f"{label}: 보험료 금액 노출인데 산출기준 미기재"
                         "(가입담보·나이·성별·직업(급수)·납기·만기)")
    ok = not fails
    return ok, ("통과 — 보험료 원 단위·산출기준 확인" if ok else " / ".join(fails))


def parse_premium_variation():
    ts = open(BRAND_TS, encoding="utf-8").read()
    m = re.search(r'premiumVariation:\s*"([^"]+)"', ts, re.S)
    if not m:
        sys.exit("[파서 오류] brand.ts CONDITIONAL_NOTICES.premiumVariation 을 찾지 못했습니다.")
    return m.group(1)


def check_premium_variation(article):
    """금액(가입금액·보험료) 노출 시 변동 가능성 안내문구 필수.
    근거: 1호 네이버 반송 사유 ④ + 팜스 스레드 자동생성본에 동일 항목 존재(CLAUDE.md §6.3).
    ⚠️ 본진은 제외한다 — 푸터가 상시노출하므로 본문 요구는 오탐(FOOTER_COVERED 주석 참조)."""
    notice = parse_premium_variation()
    fails = []
    for label, text in pending_bodies(article, exclude=FOOTER_COVERED):
        if ANY_MONEY.search(text) and notice not in text:
            fails.append(f"{label}: 금액 노출인데 premiumVariation 자구 없음")
    ok = not fails
    return ok, ("통과 — 금액 노출 시 변동 안내문구 확인" if ok else " / ".join(fails))


# ────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        sys.exit("사용법: python scripts/preflight.py <slug>")
    slug = sys.argv[1]
    article = fetch_article(slug)

    results = [
        ("금지어 §6.10", *check_banned(article)),
        ("보험료 표기", *check_premium_notation(article)),
        ("변동 안내문구", *check_premium_variation(article)),
        ("필수 유의문구", *check_notice_wiring()),
        ("출처 4요소", *check_sources(article)),
        ("출처 자료명", *check_source_titles(article)),
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
