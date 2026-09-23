#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
팜스 제출 전 기계 검증 — 사람이 눈으로 훑는 대신 스크립트가 전수 대조한다.

    python scripts/preflight.py <slug>

Supabase에서 기사를 읽어 13개 항목을 검사한다. 하나라도 실패하면 exit code 1.

⚠️ 단일 출처 원칙: 금지어·필수문구 목록을 이 파일에 하드코딩하지 않는다.
   - 금지어: src/lib/compliance/banned-terms.ts 의 term/정규식을 파싱해 사용.
   - 필수 유의문구: src/lib/brand.ts 의 REQUIRED_NOTICES·ACTUAL_LOSS_NOTICE 를 파싱해 사용.
   목록이 바뀌면 저 파일만 고치면 preflight도 자동으로 따라간다.

배경: 3호 팜스 반송(2026-07-27) — ① 출처 미명확 ② 약관 참조 유의문구.
   ① 출처는 stored content에서 직접 잡는다(check_sources).
   ② 유의문구는 원고에 저장되지 않고 렌더/익스포트 시 주입된다(본진=ArticleNotice,
      네이버·블로그스팟=osmu). 승인된 checklist-7도 stored content엔 유의문구가 없으므로
      본문 스캔은 오탐 → '딜리버리 경로가 살아있는가'를 검사한다(check_notice_wiring).

인증: 기존 .mjs 스크립트와 동일한 환경변수(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
      REST(PostgREST)로 읽는다. 새 인증 방식을 만들지 않는다.
"""
# ⚠️ 이 파일의 정규식을 SQL로 옮겨 검증하지 말 것. Postgres ARE는 `.`이 개행을 매치하고
#    RE 전체 탐욕성을 첫 수량자가 결정해 결과가 달라진다(2026-07-30 실측: 3호 2,708 → 1,271 오판).
import hashlib
import os
import re
import sys
import json
from datetime import datetime, timezone

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
    cols = ("id,slug,title,naver_title,blogspot_title,category,tags,"
            "naver_composed_at,naver_composed_hash,"
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


def mark_preflight(article_id, passed):
    """preflight 결과를 premium_articles.preflight_passed_at 에 남긴다 (2026-09-22).

    종전에는 결과가 exit code 로만 나가서 "접수 대기 = preflight 통과본"을 셀 수 없었다.
    통과하면 시각을 찍고, 실패하면 NULL 로 되돌린다 — 고치다가 깨진 원고가 통과본으로
    남아 있으면 버퍼 숫자가 거짓이 된다.
    기록에 실패해도 판정 결과(exit code)는 바꾸지 않는다. 검사기가 본업이다.
    """
    env = load_env()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key or not article_id:
        return "기록 생략 — env 또는 기사 id 없음"
    stamp = datetime.now(timezone.utc).isoformat() if passed else None
    try:
        r = requests.patch(
            f"{url}/rest/v1/premium_articles",
            params={"id": f"eq.{article_id}"},
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Content-Type": "application/json", "Prefer": "return=minimal"},
            json={"preflight_passed_at": stamp},
            timeout=30,
        )
        if r.status_code not in (200, 204):
            return f"기록 실패 HTTP {r.status_code}"
    except Exception as e:  # noqa: BLE001
        return f"기록 실패 {type(e).__name__}"
    return f"preflight_passed_at = {stamp or 'NULL'}"


# ────────────────────────────────────────────────
# 단일 출처 파서 (brand.ts / banned-terms.ts)
# ────────────────────────────────────────────────
def parse_required_notices():
    ts = open(BRAND_TS, encoding="utf-8").read()
    m = re.search(r"export const REQUIRED_NOTICES\s*=\s*\[(.*?)\]\s*as const", ts, re.S)
    if not m:
        sys.exit("[파서 오류] brand.ts REQUIRED_NOTICES 를 찾지 못했습니다.")
    return re.findall(r'"([^"]+)"', m.group(1))


def parse_actual_loss_notice():
    """실손 주제 글에만 붙는 세 번째 유의문구 + 주제 판정 정규식 — brand.ts 단일 소스.

    🔴 CONDITIONAL_NOTICES.actualLoss("실비보험은 자기부담금을 제외한 ...")와 **다른 문장**이다.
       PAMS 가 2026-09-23 반송하며 요구한 자구는 ACTUAL_LOSS_NOTICE 쪽이다. 섞지 마라.
    """
    ts = open(BRAND_TS, encoding="utf-8").read()
    m = re.search(r'export const ACTUAL_LOSS_NOTICE\s*=\s*"([^"]+)"', ts)
    if not m:
        sys.exit("[파서 오류] brand.ts ACTUAL_LOSS_NOTICE 를 찾지 못했습니다.")
    notice = m.group(1)
    r = re.search(r"const ACTUAL_LOSS_RE\s*=\s*/(.+?)/", ts, re.S)
    if not r:
        sys.exit("[파서 오류] brand.ts ACTUAL_LOSS_RE 를 찾지 못했습니다.")
    try:
        rx = re.compile(r.group(1).strip())
    except re.error:
        sys.exit("[파서 오류] ACTUAL_LOSS_RE 를 파이썬 정규식으로 옮기지 못했습니다.")
    return notice, rx


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

    # [2026-09-23] 본진·osmu 는 requiredNoticesFor() 를 거친다(실손이면 3종).
    #   푸터는 글 단위가 아니라 사이트 전역이라 기본 2종 그대로가 맞다.
    wiring = [
        ("본진 ArticleView→ArticleNotice", "src/components/news/ArticleView.tsx", "ArticleNotice"),
        ("ArticleNotice→requiredNoticesFor", "src/components/news/ArticleNotice.tsx", "requiredNoticesFor"),
        ("osmu 바이럴 본문 주입", "src/lib/osmu-format.ts", "requiredNoticesFor"),
        ("푸터", "src/components/Footer.tsx", "REQUIRED_NOTICES"),
        ("실손 문구 상수", "src/lib/brand.ts", "ACTUAL_LOSS_NOTICE"),
    ]
    for label, path, needle in wiring:
        if not refs(path, needle):
            problems.append(f"{label} 끊김({path})")
    ok = not problems
    return ok, ("통과 — 필수 유의문구 딜리버리 경로 정상(ArticleNotice·osmu·푸터)"
                if ok else " / ".join(problems))


def check_actual_loss_notice(article):
    """실손 주제 글이면 자기부담금 한 줄이 원고에 있는가 (2026-09-23 PAMS 반송 요구).

    ⚠️ check_notice_wiring 과 반대로 **본문을 스캔한다.** 이유가 다르기 때문이다.
       기본 2종은 저장 원고에 없고 렌더·조립 때 주입된다(본문 스캔이 곧 오탐).
       자기부담금 문구는 PAMS 접수 원고 자체에 보여야 해서 본진 원고에 직접 박는다.
    · 본진(main_website_markdown): 없으면 **실패**.
    · 네이버·블로그스팟: osmu 가 조립할 때 넣어 주므로 없으면 **경고**(실패 아님).
      단, raw 복사 사고(초안2)를 생각하면 원고에 박아 두는 편이 안전하다.
    · 실손 주제가 아니면 검사 자체를 건너뛴다.
    """
    notice, rx = parse_actual_loss_notice()
    probe = " ".join(
        str(article.get(f) or "")
        for f in ["title", "naver_title", "blogspot_title", "main_website_markdown"]
    )
    if not rx.search(probe):
        return True, "해당 없음 — 실손 주제가 아닙니다"

    fails, warns = [], []
    for label, field in BODY_FIELDS:
        text = article.get(field) or ""
        if not text:
            continue
        if notice in text:
            continue
        (fails if field == "main_website_markdown" else warns).append(label)
    detail = f"실손 주제 · 자구 「{notice}」"
    if fails:
        detail += " · 누락(실패): " + ", ".join(fails)
    if warns:
        detail += " · 원고에 없음(경고 — osmu 가 주입): " + ", ".join(warns)
    if not fails and not warns:
        detail += " · 전 채널 원고 포함"
    return not fails, detail


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


def parse_sources_full():
    """대장 전체 — 자료명뿐 아니라 발표일까지 본다."""
    with open(SOURCES_JSON, encoding="utf-8") as fp:
        return json.load(fp).get("sources", [])


def check_source_titles(article):
    """자료명이 대장 정본과 **글자 그대로** 같은지 대조한다.

    근거: 2호 네이버 반송(2026-07-30) — 「계약 전 알릴의무 안내」로 축약해 반송.

    [2026-09-22] 보는 자리를 셋으로 넓혔다.
      ① 본문 「」 (종전)
      ② **raw_source_name** — ArticleView.tsx 가 화면에 출처 줄로 내보내는 값이다.
         독자와 심의가 보는 자리인데 BODY_FIELDS 에 없어 검사 밖이었다.
      ③ **「」 없이 쓴 변형** — 대장 자료명의 앞 12자를 본문에서 찾았는데 그 자리에
         정본 전체가 없으면 축약·변형으로 본다. 8865 가 바로 이 형태였다.
    그리고 자료를 날짜와 함께 인용했다면 **발표일 전체**여야 한다(연도만 쓰는 축약 금지)."""
    titles = parse_source_titles()
    srcs = parse_sources_full()
    fails = []
    scopes = list(pending_bodies(article))
    if article.get("raw_source_name"):
        scopes.append(("출처줄", article["raw_source_name"]))
    for label, text in scopes:
        for m in QUOTED_TITLE.finditer(text):
            got = m.group(1).strip()
            if got not in titles:
                fails.append(f"{label}: 대장에 없는 자료명 — 「{got}」")
        flat = re.sub(r"\s+", "", text)
        for s_ in srcs:
            t = s_.get("title") or ""
            if len(t) < 14:
                continue
            stem = re.sub(r"\s+", "", t)[:12]
            if stem and stem in flat and re.sub(r"\s+", "", t) not in flat:
                fails.append(f"{label}: 자료명이 정본과 다르다(축약·변형) — 정본 「{t}」")
            # 날짜와 함께 인용했다면 발표일 전체여야 한다
            pub = (s_.get("published") or "").strip()
            if pub and re.sub(r"\s+", "", t) in flat:
                year = pub.split(".")[0]
                if f"({year})" in flat and re.sub(r"\s+", "", f"({pub})") not in flat:
                    fails.append(f"{label}: 발표일 축약 — ({year}) 가 아니라 ({pub}) 로 쓸 것")
    fails = sorted(set(fails))
    ok = not fails
    return ok, ("통과 — 자료명 정본·발표일 대조 완료" if ok else
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
    # ⚠️ 여러 줄 주석·링크 텍스트 처리 결함 교정(2026-07-30).
    #    표·헤딩·불릿을 포함하는 것은 의도된 정책이다 — 담보 단위 합산표가 이 브랜드의 실질이다.
    # 순서 주의: 주석을 먼저 지워야 주석 안 링크가 본문으로 집계되지 않는다.
    plain = re.sub(r"<!--.*?-->", "", md, flags=re.DOTALL)
    plain = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", plain)  # 링크 텍스트는 본문 — URL만 제거
    plain = re.sub(r"[#>*`|]|-{2,}", "", plain)
    plain = re.sub(r"\s+", "", plain)
    n = len(plain)
    ok = 2000 <= n <= 3200
    return ok, f"본진 {n}자" + ("" if ok else " — 범위(2,000~3,200자) 이탈")


def _card_fit(path):
    """카드 config 폭 검사(fit_or_fail) — scripts/check_card_config.py 단일 소스.

    [2026-09-23] 5호 첫 렌더에서 표 칸이 겹쳐 읽을 수 없었다(실측). 렌더러는 그래도
    이미지를 만들어 내므로, 조용히 못 읽는 카드가 심의에 첨부되는 경로가 열려 있었다.
    검사기가 없으면 여기서 잡을 방법이 없다 — 있으면 쓰고, 없으면 config 존재만 본다.
    """
    try:
        sys.path.insert(0, os.path.join(ROOT, "scripts"))
        import check_card_config as _ccc
        import json as _json
        cfg = _json.load(open(path, encoding="utf-8"))
        return _ccc.check(cfg)
    except Exception as e:  # noqa: BLE001
        return [], [f"폭 검사를 돌리지 못했다({type(e).__name__}) — check_card_config.py 확인"]


def check_image_config(slug, article):
    exact = os.path.join(CONFIGS_DIR, f"{slug}.json")
    if os.path.exists(exact):
        bad, notes = _card_fit(exact)
        tail = (" · 폭 경고 " + str(len(notes)) + "건") if notes else ""
        if bad:
            return False, (f"configs/{slug}.json — 칸이 넘쳐 겹친다: " + " / ".join(bad[:2])
                           + ("" if len(bad) <= 2 else f" 외 {len(bad)-2}건")
                           + "  → python scripts/check_card_config.py " + slug)
        return True, f"configs/{slug}.json{tail}"
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


def parse_simplified_issue():
    ts = open(BRAND_TS, encoding="utf-8").read()
    m = re.search(r'simplifiedIssue:\s*"([^"]+)"', ts, re.S)
    if not m:
        sys.exit("[파서 오류] brand.ts CONDITIONAL_NOTICES.simplifiedIssue 를 찾지 못했습니다.")
    return m.group(1)


SIMPLIFIED_TOPIC = re.compile(r"유병자|간편\s*심사|간편보험|간편\s*가입|유병력")


def check_simplified_issue(article):
    """유병자(간편) 상품을 다루면 인수 거절 가능성 안내문구 필수.

    근거: 2호 네이버 반송(2026-07-30, 심의 2026-07-8865) 사유 (4) — "유병자(간편) 상품
    안내문구 누락". 자구는 brand.ts CONDITIONAL_NOTICES.simplifiedIssue 하나다(단일 출처).
    ⚠️ 이 항목이 종전 9개 검사에 **없었다**(2026-09-22 대조에서 발견). 자구는 brand.ts 에
       있었지만 그것을 요구하는 검사가 없어 같은 사유로 또 반송될 수 있었다.
    본진은 제외하지 않는다 — premiumVariation 과 달리 푸터가 이 문구를 상시노출하지 않는다.
    """
    notice = parse_simplified_issue()
    fails = []
    for label, text in pending_bodies(article):
        if SIMPLIFIED_TOPIC.search(text) and notice not in text:
            fails.append(f"{label}: 유병자(간편) 언급인데 simplifiedIssue 자구 없음")
    ok = not fails
    return ok, ("통과 — 유병자(간편) 안내문구 확인" if ok else " / ".join(fails)
                + "  → brand.ts CONDITIONAL_NOTICES.simplifiedIssue 자구를 본문에 넣을 것")


# src/lib/naver-compose-hash.ts 와 **같은 규칙**이어야 한다. 한쪽만 바꾸면 멀쩡한 원고가
# 영구 실패로 남는다. 계약: 필드 순서 고정 · 없으면 빈 문자열 · tags 는 원래 순서 그대로
#   UNIT 으로 이음 · 필드 구분 REC · 개행 LF 통일 · 줄끝 공백 제거 · 앞뒤 공백 제거
_UNIT = "\u001f"
_REC = "\u001e"


def _norm_field(v):
    t = "" if v is None else str(v)
    t = re.sub(r"\r\n?", "\n", t)
    t = re.sub(r"[ \t]+$", "", t, flags=re.M)
    return t.strip()


def naver_compose_hash(article):
    """osmu 가 소비하는 재료의 sha256 — 조립 시점 값과 대조한다."""
    tags = article.get("tags") or []
    canonical = _REC.join([
        _norm_field(article.get("naver_blog_content")),
        _norm_field(article.get("title")),
        _norm_field(article.get("naver_title")),
        _norm_field(article.get("slug")),
        _UNIT.join(_norm_field(t) for t in tags),
    ])
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def check_naver_osmu_parity(article):
    """네이버에 붙여넣는 원고가 **osmu-format 출력**과 같은 재료인가 (2026-09-22 신설).

    🔴 왜: 관리자 복사 버튼이 raw naver_blog_content 를 그대로 내보내면 개인의견 귀속 문구
       (REQUIRED_NOTICES)와 필수안내사항이 빠진 채 접수된다. 초안2 네이버가 실제로 그렇게
       접수됐다. 버튼은 고쳤지만, 원고 쪽에서도 같은 사고를 막는 그물이 필요하다.

    ⚠️ **완전 대조는 여기서 못 한다.** osmu-format 은 TypeScript 이고 본문에 원문 링크·해시태그·
       필수안내사항을 붙이는데, 그건 저장된 원고가 아니라 **복사 시점에** 붙는다(심의필 번호가
       그때 정해지므로 저장할 수도 없다). 그래서 저장분에 대고 "같은가"를 물으면 늘 틀린다.
       대신 **osmu 가 손대는 자리를 원고가 미리 침범하지 않았는가**를 본다:
         ① 필수안내사항을 원고에 직접 써 두지 않았는가 (복사 때 두 번 붙는다)
         ② osmu 구분선(─────)을 원고가 이미 쓰고 있지 않은가
         ③ 원문 링크·해시태그를 원고에 박아 두지 않았는가
         ④ 마크다운 잔재(표·헤딩 기호·굵게)가 남아 있지 않은가 — osmu 가 지우는 것들이다
       ⑤ 필수 유의문구 2종은 osmu 가 **본문에** 넣는다. 원고에 이미 있으면 osmu 가 건너뛰므로
          있어도 되고 없어도 된다 — 검사하지 않는다.

    남은 구멍: 버튼이 osmu 를 안 거치는 경우는 이 검사로 못 잡는다.
      → 완전 대조를 원하면 방법은 하나다. `/api/admin/compose` 를 **유일한 복사 경로**로 두고
        (게시용도 서버 조립으로 옮긴다), 서버가 조립 결과를 premium_articles 에
        `naver_composed_at` 과 함께 남긴다. 그러면 이 함수가 "마지막 조립이 원고 수정보다
        뒤인가"를 대조할 수 있다. 칸 하나와 라우트 한 곳을 고치는 일이라 별도 승인 후에 한다.
    """
    text = article.get("naver_blog_content") or ""
    if not text:
        return True, "네이버 원고 없음 — 검사 생략"
    fails = []
    if "[필수안내사항]" in text or "심의필 제" in text:
        fails.append("필수안내사항이 원고에 박혀 있다 — 복사 시 osmu 가 붙이므로 두 번 들어간다")
    if "─────" in text:
        fails.append("osmu 구분선(─────)이 원고에 있다")
    if re.search(r"goodfinance\.kr/news/", text):
        fails.append("원문 링크가 원고에 박혀 있다 — osmu 가 붙인다")
    if re.search(r"(^|\s)#[0-9A-Za-z가-힣]{2,}", text):
        fails.append("해시태그가 원고에 박혀 있다 — osmu 가 tags 로 붙인다")
    md = []
    if re.search(r"^\s*#{1,6}\s", text, re.M):
        md.append("헤딩(#)")
    if re.search(r"\*\*[^*]+\*\*", text):
        md.append("굵게(**)")
    if re.search(r"^\s*\|.*\|\s*$", text, re.M):
        md.append("표(|)")
    if re.search(r"\[[^\]]+\]\(https?://", text):
        md.append("링크([](…))")
    if md:
        fails.append("마크다운 잔재: " + ", ".join(md))
    # ── 완전 대조 (2026-09-22) ──
    #   /api/admin/compose 가 조립할 때 남긴 재료 해시를 지금 원고로 다시 계산해 비교한다.
    #   같으면 "마지막 복사가 osmu 조립을 거쳤고 그 뒤로 원고가 안 바뀌었다"가 증명된다.
    #   🔴 시각(naver_composed_at)으로는 대신할 수 없다 — trg_premium_articles_updated 가
    #      모든 UPDATE 에서 updated_at 을 바꿔 조립 기록 자체가 updated_at 을 올린다.
    stored = article.get("naver_composed_hash")
    when = str(article.get("naver_composed_at") or "")[:16]
    note = ""
    if not stored:
        # 🔴 기록이 없는 것은 **잘못이 아니다** — 아직 복사를 안 누른 새 원고일 뿐이다.
        #   여기서 실패시키면 버퍼(접수 대기 = preflight 통과본)가 0으로 떨어지고,
        #   06:30 크론이 "더 만들 편수"를 과다 계산해 초안을 계속 쌓는다.
        #   실제 사고(귀속 문구·필수안내 누락)는 아래 두 그물이 잡는다:
        #     · 조립 뒤 원고가 바뀌면 해시 불일치로 실패
        #     · 원고가 osmu 자리를 침범하면 위 검사들이 실패
        #   복사 경로가 compose 하나뿐이므로 "복사했는데 조립을 안 거쳤다"는 성립하지 않는다.
        note = " · 조립 기록 없음(아직 복사 전) — 접수 전에 복사 버튼을 한 번 누를 것"
    else:
        now_hash = naver_compose_hash(article)
        if now_hash != stored:
            fails.append(
                f"원고가 마지막 조립({when}) 뒤에 바뀌었다 — 복사 버튼을 다시 눌러 조립본을 쓰라")
    ok = not fails
    return ok, ((f"통과 — osmu 조립본과 일치({when})" if stored else "통과" + note) if ok
                else " / ".join(fails) + "  → 원고에서 빼라. 복사 시 osmu-format 이 붙인다")


def check_naver_format(article):
    """네이버 원고가 **게시본 형식**인가 (2026-09-22 신설).

    🔴 왜 생겼나: 초안1이 옛 형식(`항목 — 설명` 줄)인데 11/11 을 통과했다. 검사가 없었다.
       [2026-09-22 정정] 「네이버가 서식을 전부 지운다」는 틀렸다 — HTML 서식째 복사로
       크기·굵게·사진·인용구가 들어간다(색만 네이버가 바꾼다). 그래도 이 검사는 유효하다:
       naver-rich 는 **이미 만들어진 텍스트에 크기만 입힌다.** 구조가 글자 자체로 서 있지
       않으면 서식을 입힐 자리가 없다(소제목·번호목록·▶ 줄을 그 형태로 찾아 쓴다).

    네 가지를 본다. 네이버 원고가 없으면 검사하지 않는다.
      ① 용어 정의는 `N. 용어 · 설명` 번호 목록
      ② 비교표는 `▶ 경우 · 값` 줄 (덜 풀린 `항목 — 설명` 줄이 남으면 실패)
      ③ 소제목은 「알아두실 용어 N가지」 — 개수가 붙고 항목 수와 맞아야 한다
      ④ 한 줄 조언 라벨은 `▶ 신순주 지사장의 한 줄 조언` (인용부호·HTML 주석 금지)
    """
    text = article.get("naver_blog_content") or ""
    if not text:
        return True, "네이버 원고 없음 — 검사 생략"
    fails = []
    rows = [ln.strip() for ln in text.split(chr(10))]

    head = [ln for ln in rows if ln.startswith("알아두실 용어")]
    if not head:
        fails.append("소제목 「알아두실 용어 N가지」 없음")
    elif not re.match(r"^알아두실 용어 \d+가지$", head[0]):
        fails.append("소제목에 개수가 없다 — 「" + head[0] + "」 → 「알아두실 용어 N가지」")

    if head:
        i = rows.index(head[0])
        # 소제목 다음 번호 목록 덩어리만 센다 — 고정 창으로 자르면 항목이 길 때 잘린다
        numbered = []
        for ln in rows[i + 1:]:
            if not ln:
                continue
            if re.match(r"^\d+\.\s+.+?\s+·\s+\S", ln):
                numbered.append(ln)
            elif numbered:
                break
            elif len(numbered) == 0 and len(ln) > 0:
                break
        if len(numbered) < 2:
            fails.append("용어 정의가 「N. 용어 · 설명」 번호 목록이 아니다")
        m = re.match(r"^알아두실 용어 (\d+)가지$", head[0])
        if m and numbered and int(m.group(1)) != len(numbered):
            fails.append("소제목 개수(" + m.group(1) + ")와 항목 수(" + str(len(numbered)) + ")가 다르다")

    bullets = [ln for ln in rows if ln.startswith("▶ ") and " · " in ln]
    leftover = [ln for ln in rows if " — " in ln and len(ln) <= 90
                and not ln.endswith(".") and not ln.startswith("▶")]
    if leftover:
        fails.append("표가 덜 풀렸다(「항목 — 설명」 줄 " + str(len(leftover)) + "개) — "
                     "「▶ 항목 · 값」 으로 풀 것: " + leftover[0][:40])

    if "신순주 지사장의 한 줄 조언" in text and "▶ 신순주 지사장의 한 줄 조언" not in text:
        fails.append("한 줄 조언 라벨에 ▶ 가 없다")
    if "<!--" in text:
        fails.append("네이버 원고에 HTML 주석이 남아 있다")

    ok = not fails
    return ok, ("통과 — 번호 목록·▶ 줄 " + str(len(bullets)) + "개·소제목 개수·조언 라벨 확인" if ok
                else " / ".join(fails) + "  → WRITING-SPEC 「네이버 원고에서 표를 푸는 두 형태」 참고")


def _title_tail(t):
    """제목의 뒷절 — 마지막 구분자(— – : |) 뒤. 구분자가 없으면 제목 전체."""
    parts = re.split(r"\s*[—–:|]\s*", str(t or "").strip())
    return re.sub(r"\s+", "", parts[-1]) if parts else ""


def check_title_variation(article):
    """본진 제목과 네이버 제목이 **다른 검색어를 노리는가**.

    근거: 2026-09-22 수요 실측 — 같은 내용도 제도명으로 부르면 질문이 6분의 1이다
    (「실손 전환 철회」 9.48 vs 「실손 갈아탄 후」 1.61, 블로그÷지식iN).
    두 제목이 사실상 같으면 채널을 둘로 쓰는 값어치가 사라지고, 네이버에서는 본진과
    같은 검색어로 우리끼리 경쟁한다.

    판정: **뒷절(마지막 구분자 뒤)이 같으면 실패.** 앞절은 같은 소재를 가리키므로 겹쳐도 된다.
    네이버 제목이 없으면 검사하지 않는다(그 채널을 안 쓰는 글이다).
    """
    main_t = article.get("title") or ""
    nv_t = article.get("naver_title") or ""
    if not nv_t:
        return True, "네이버 제목 없음 — 검사 생략"
    fails = []
    tail_m, tail_n = _title_tail(main_t), _title_tail(nv_t)
    if tail_m and tail_m == tail_n:
        fails.append(f"본진·네이버 제목의 뒷절이 같다 — '{tail_m[:30]}'")
    if re.sub(r"\s+", "", main_t) == re.sub(r"\s+", "", nv_t):
        fails.append("두 제목이 완전히 같다")
    ok = not fails
    return ok, ("통과 — 본진·네이버 제목이 다른 각도" if ok else
                " / ".join(fails) + "  → 네이버 제목은 소비자 검색어로 다시 잡을 것"
                "(TOPIC-BANK 수요 실측 참고)")




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
        ("유병자 안내문구", *check_simplified_issue(article)),
        ("필수 유의문구", *check_notice_wiring()),
        ("실손 자기부담금", *check_actual_loss_notice(article)),
        ("출처 4요소", *check_sources(article)),
        ("출처 자료명", *check_source_titles(article)),
        ("제목 각도", *check_title_variation(article)),
        ("네이버 형식", *check_naver_format(article)),
        ("네이버 osmu", *check_naver_osmu_parity(article)),
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
    기록 = mark_preflight(article.get("id"), all_ok)
    print(f"  [{'기록':<12}] {기록}")
    print()
    if not all_ok:
        print("결과: 실패 — 위 항목을 해소한 뒤 팜스 제출하세요.")
        sys.exit(1)
    print("결과: 통과 — 팜스 제출 가능.")


if __name__ == "__main__":
    main()
