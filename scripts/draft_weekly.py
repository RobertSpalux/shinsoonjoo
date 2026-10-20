#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
심의용 원고 초안 공급기 — 수요 근거 대기열 + 연금·종신·법인·절세 순환 (SH13 2026-10-12 · SUP1 2026-10-20).
매일 1편 자동 공급은 scripts/draft_daily.py(작업 스케줄러 SHIN_draft_daily 06:30)가 이 모듈의 generate_one 을 부른다.

    python scripts/draft_weekly.py --plan                       # 이번 주에 쓸 주제만 보여 준다(생성 없음)
    python scripts/draft_weekly.py                              # 3편 생성 → 게이트 → 통과분 drafts / 반려분 _rejected
    python scripts/draft_weekly.py --topic <slug>               # 주제 하나만(순환 무시)
    python scripts/draft_weekly.py --from-json <draft.json> --topic <slug>   # 이미 쓴 원고(JSON)를 게이트에만 건다
    옵션: --count N · --out <폴더> · --no-db(주제 중복·DB 문장 대조 생략) · --skip-ts-gate(check_draft.mts 생략)

왜: 스레드·본진·네이버가 멈춘 원인은 심의에 넣을 원고가 0편인 것이었다(사람 차례 적체, 2026-10-12).
    로버트 손은 주 1회 PAMS 접수뿐이어야 한다 → 접수할 원고가 매주 **초안으로** 쌓여 있어야 한다.
    쓰는 것까지가 이 스크립트다. 무엇을 접수할지 고르는 것·DB 저장(draft_insert --insert)·접수는 사람이다.

하는 일 (DB·PAMS·게시·텔레그램 쓰기 0):
  ① 주제: configs/draft_topics.json 위에서부터 아직 안 쓴 것 N개(출력 폴더의 통과·반려 기록으로 판정)
  ② 생성: `claude -p`(구독). 환경에 ANTHROPIC_API_KEY 등이 보이면 실행하지 않는다(유료 청구 차단)
  ③ 게이트 — 하나라도 걸리면 반려:
     · 금소법(rules_finance_gate.md): 무료·수익률 단정·비교추천·저축성 표현·상담 유인·보험사명·일화·금액 노출,
       비과세·세금·종신 유의문구 원문 포함
     · 금지어 A 등급(preflight — banned-terms.ts 와 같은 정규식)
     · 네이버 규칙 10(naver_rules — 제목·키워드·본문 길이·FAQ·요약·내부링크)
     · 문장 겹침: 이미 게시·접수된 원고(DB premium_articles)·스레드 원고·지난 초안과 같은 문장 금지
     · 주제 중복(topic_guard — DB 읽기)
     · 금지어·문체·근거 게이트(scripts/check_draft.mts, #73)
  ④ 통과: <out>/<YYYYMMDD>_<slug>/ meta.json · naver.txt · main.md · gate.json
     반려: <out>/_rejected/<YYYYMMDD>_<slug>/ 같은 파일 + <out>/_rejected.md 에 단계·사유·문장
  모르는 수치는 [확인: ___] 로 남긴다 — 통과해도 gate.json 「확인 필요」 목록에 올라 사람이 채운다.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import naver_rules  # noqa: E402
import pams_kit as kit  # noqa: E402
import preflight  # noqa: E402
import topic_guard  # noqa: E402

ROOT = kit.ROOT
TOPICS_JSON = os.path.join(ROOT, "configs", "draft_topics.json")
RULES_MD = os.environ.get("SHIN_FINANCE_RULES", r"D:\robert-os\shared\rules\rules_finance_gate.md")
OUT_DIR = os.environ.get("SHIN_DRAFTS_DIR", r"D:\robert-os\content-factory\drafts\finance")
THREADS_DIR = os.path.join(ROOT, "assets", "threads")
CLAUDE_EXE = os.environ.get("CLAUDE_EXE", os.path.join(os.path.expanduser("~"), ".local", "bin", "claude.exe"))
API_ENV_KEYS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL")
WEEKLY = 3
CLAUDE_TIMEOUT = 20 * 60
DB_CATEGORY = {"연금": "연금·노후·세테크", "절세": "연금·노후·세테크", "종신": "보험 리모델링", "법인": "보험 리모델링",
               # SUP1(2026-10-20) 수요 근거 주제 — DB premium_articles.category 의 기존 값만 쓴다
               "실손": "실손·보장성 가이드", "보장": "실손·보장성 가이드", "고지": "실손·보장성 가이드",
               "배상": "배상책임", "리모델링": "보험 리모델링"}
# 네이버 사진 5장 설정(naver_images.py · naver_images_more.py 틀) — 생성 결과의 선택 키 naver_images.
#   slug·cta_url 은 코드가 채운다(모델이 쓰지 않는다).
IMAGE_KEYS = ["overline", "title", "subtitle", "table_title", "col_before", "col_after", "table_rows", "table_note",
              "contrast_title", "contrast", "contrast_note", "flow_title", "flow", "flow_note",
              "points_title", "points", "cta_line", "cta_sub"]
CTA_URL = "goodfinance.kr/diagnosis"

# ── 금소법 게이트 규칙 (rules_finance_gate.md 2단·17항에서 기계로 잴 수 있는 것만) ──────────────
CHECK_MARK = re.compile(r"\[확인:[^\]]*\]")
MONEY = re.compile(r"\d[\d,.]*\s*(?:만\s*원|억\s*원|천\s*원|원)|[₩$￦＄]")
PERCENT = re.compile(r"\d[\d,.]*\s*%")
RATE_WORD = re.compile(r"수익률|이율|환급률|금리|공제율")
ALWAYS_BANNED = [
    ("무료", re.compile(r"무료")),
    ("수익률 단정", re.compile(r"확정\s*수익|원금\s*보장|수익\s*보장|수익률(?:을|이)?\s*보장|손해\s*볼\s*일이\s*없")),
    ("비교·추천", re.compile(r"추천(?:합니다|드립니다|해\s*드립니다|드려요)|가입하세요|가입하시길|더\s*유리합니다|보다\s*유리|순위|[0-9]+위|베스트")),
    ("타 업권 비교", re.compile(r"(?:은행|예금|적금|펀드|주식)(?:보다|과\s*비교|와\s*비교|에\s*비해)")),
    ("상담 유인", re.compile(r"상담\s*(?:신청|문의|예약)|문의\s*주세요|연락\s*주세요|카카오톡|카톡|진단\s*받아|DM|댓글\s*주세요")),
    ("보험료 절감 오인", re.compile(r"보험료를?\s*(?:줄|아끼|아낄|절감)|절감")),
    ("컨설팅 프레임", re.compile(r"재무\s*컨설팅|절세\s*솔루션|CEO\s*플랜|재무설계|자산\s*관리\s*솔루션")),
    ("다급함", re.compile(r"지금\s*바로|당장|늦기\s*전에|서두르|마지막\s*기회|한도\s*축소")),
    ("일화 날조", re.compile(r"(?:어제|지난\s*주|지난\s*달|작년\s*\d+\s*월|\d+\s*월\s*\d+\s*일)[^.\n]{0,30}(?:고객|분이|분께서|씨가)|(?<![A-Za-z])[A-Z]\s?씨(?:가|는|의)")),
    ("보험사명", re.compile(r"삼성생명|삼성화재|한화생명|한화손|교보|흥국|현대해상|DB손|DB생명|KB손|KB라이프|메리츠|롯데손|신한라이프|미래에셋생명|동양생명|ABL|AIA|라이나|처브|농협생명|농협손|동부생명|푸본|하나생명|하나손|우체국")),
    ("비방", re.compile(r"설계사(?:는|들은|들이)\s*(?:안|잘\s*모르|알려주지)|보험사(?:가|는)\s*(?:싫어|안\s*알려|배불)")),
]
# 보장성(종신·법인 보장) 상품 저축성 표현 — 조건부사례집 ②-3, 17항 ⑧
#   「수익자」(계약 관계자)·「거치다」(동사)는 저축성 표현이 아니다.
SAVINGS_WORDS = re.compile(r"목돈|투자|이익|이득|수익(?!자)|저축|노후\s*대비|거치(?:식|형|기간)|생활비|목적자금|이자(?![가-힣])")
# 연금(저축성)도 목돈 마련·목적자금·수익 위주 설명은 금지(17항 ⑧-(4))
ANNUITY_WORDS = re.compile(r"목돈|이득|이익|수익(?!자)|목적자금|교육비|여행자금|생활비")
TAX_WORDS = re.compile(r"세금|세액공제|소득공제|비과세|상속세|증여세|법인세|과세|세법")
TAX_FREE = re.compile(r"비과세")
TITLE_TAX_FREE_SUFFIX = "관련 세법 요건 충족시"


# ── 장부 · 주제 ──────────────────────────────────────────────
def load_topics(path=TOPICS_JSON):
    with open(path, encoding="utf-8") as fp:
        return json.load(fp)


def used_slugs(out_dir):
    """출력 폴더(통과)·_rejected(반려)에 이미 있는 slug — 폴더 이름이 YYYYMMDD_<slug>."""
    out = set()
    for d in (out_dir, os.path.join(out_dir, "_rejected")):
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            m = re.match(r"^\d{8}_([a-z0-9][a-z0-9-]+)$", name)
            if m and os.path.isdir(os.path.join(d, name)):
                out.add(m.group(1))
    return out


def pick_topics(cfg, used, n=WEEKLY, only=None):
    topics = cfg["topics"]
    if only:
        hit = [t for t in topics if t["slug"] == only]
        if not hit:
            raise kit.KitError(f"장부에 없는 주제: {only}")
        return hit
    return [t for t in topics if t["slug"] not in used][:n]


def notice_texts(cfg, topic):
    out = []
    for key in topic.get("notices", []):
        for s in cfg["notices"][key]:
            if s not in out:
                out.append(s)
    return out


# ── 순수 판정 ────────────────────────────────────────────────
def _norm(s):
    return re.sub(r"[^0-9A-Za-z가-힣]", "", s or "")


def strip_notices(text, notices):
    for s in notices:
        text = text.replace(s, " ")
    return text


def sentences(text):
    out = []
    for line in (text or "").split("\n"):
        for s in re.split(r"(?<=[.!?])\s+", line.strip()):
            s = s.strip()
            if s:
                out.append(s)
    return out


def placeholders(text):
    return sorted(set(CHECK_MARK.findall(text or "")))


def finance_gate(draft, topic, notices, exempt=()):
    """→ 이슈 목록 [{stage, reason, sentence}]. 비면 통과. 유의문구 원문은 표현 검사에서 빼고, 포함 여부는 따로 본다.
    exempt: 표현 검사에서만 빼는 다른 정본 문구(필수 유의문구 2종 — 「이익 또는 손실」이 저축성 표현에 걸리지 않게)."""
    required, notices = notices, list(notices) + [s for s in exempt if s not in notices]
    issues = []
    title_fields = {"제목": draft.get("title", ""), "네이버 제목": draft.get("naver_title", "")}
    bodies = {"네이버": draft.get("naver", ""), "본진": draft.get("main", "")}
    cat = topic["category"]

    def scan(label, text, rx_list, stage):
        for s in sentences(CHECK_MARK.sub(" ", strip_notices(text, notices))):
            for name, rx in rx_list:
                m = rx.search(s)
                if m:
                    issues.append({"stage": stage, "reason": f"{name} 「{m.group(0)}」({label})", "sentence": s})

    for label, text in {**title_fields, **bodies}.items():
        scan(label, text, ALWAYS_BANNED, "2단 표현")
        if cat in ("종신", "법인"):
            scan(label, text, [("보장성 저축성 표현", SAVINGS_WORDS)], "2단 상품목적")
        elif cat == "연금":
            scan(label, text, [("연금 목적 왜곡", ANNUITY_WORDS)], "2단 상품목적")
        # 금액·수익률 수치: [확인: ___] 와 유의문구 밖에 나오면 반려(제목은 무조건 반려 — 17항 ①)
        clean = CHECK_MARK.sub(" ", strip_notices(text, notices))
        for s in sentences(clean):
            if MONEY.search(s):
                issues.append({"stage": "2단 금액", "reason": f"금액 노출({label}) — 모르는 수치는 [확인: ___]", "sentence": s})
            if PERCENT.search(s) and RATE_WORD.search(s):
                issues.append({"stage": "2단 수익률", "reason": f"수익률·이율 수치 단정({label}) — [확인: ___] 로", "sentence": s})

    for label, t in title_fields.items():
        if TAX_FREE.search(t) and TITLE_TAX_FREE_SUFFIX not in t:
            issues.append({"stage": "2단 세금", "reason": f"{label}에 비과세 — 「{TITLE_TAX_FREE_SUFFIX}」 병기 필요", "sentence": t})

    for label, text in bodies.items():
        miss = [s for s in required if s not in text]
        if miss:
            issues.append({"stage": "유의문구", "reason": f"{label} 유의문구 원문 빠짐 {len(miss)}건", "sentence": " / ".join(miss)})
        body = strip_notices(text, notices)
        if TAX_WORDS.search(body) and not any(s in text for s in required if "세무사" in s):
            issues.append({"stage": "유의문구", "reason": f"{label} 세금 언급 — 세무사 상의 유의문구 필요(장부 notices 에 taxAdvice·taxFree 추가)", "sentence": TAX_WORDS.search(body).group(0)})
        if TAX_FREE.search(body) and not any("비과세 혜택은 관련 세법 요건 충족 시" in s for s in required if s in text):
            issues.append({"stage": "유의문구", "reason": f"{label} 비과세 언급 — 「비과세 혜택은 관련 세법 요건 충족 시…」 원문 필요", "sentence": "비과세"})
        initials = re.findall(r"(?<![A-Za-z])([A-Z])사(?=[가-힣\s,·.)]|$)", body)
        if initials:
            seen = list(dict.fromkeys(initials))
            if seen != [chr(ord("A") + i) for i in range(len(seen))]:
                issues.append({"stage": "2단 보험사명", "reason": f"{label} 이니셜이 A사부터 알파벳 순서가 아님: {', '.join(seen)}", "sentence": ""})
    return issues


SHINGLE = 8           # 문장 겹침 조각 길이(공백·문장부호 뺀 글자)
OVERLAP_RATIO = 0.5   # 조각 절반 이상이 이미 쓴 원고에 있으면 「베낀 문장」 — 조사 한두 개 바꾼 복붙도 잡는다


def shingles(s, k=SHINGLE):
    n = _norm(s)
    return {n[i:i + k] for i in range(len(n) - k + 1)} if len(n) >= k else set()


def build_corpus(docs, k=SHINGLE):
    """docs: [(출처, 텍스트)] → (shingle → 출처, 정규화 문장 → 출처)."""
    sh, exact = {}, {}
    for src, text in docs:
        for s in sentences(text):
            n = _norm(s)
            if len(n) >= 15:
                exact.setdefault(n, src)
            for g in shingles(s, k):
                sh.setdefault(g, src)
    return sh, exact


SOURCE_HEAD = re.compile(r"^출처$")
SOURCE_LINE = re.compile(r"^(?:>\s*)?출처\s*[:：]")   # 한 줄 출처(「출처: 기관, 「자료명」, 연도, 발표일」) — SUP1


def canonical_lines(text):
    """원래 글마다 같아야 하는 줄 — 겹침 검사에서 뺀다(순수 함수).
    ① 내부링크 URL(우리 네이버 글·본진 기사) ② 「출처」 소제목 아래 줄(대장 정본 자료명·발표일 — 글자를 바꾸면 반송).
    2026-10-14 SH18: 같은 블로그 URL 의 숫자 조각, 같은 자료명 출처 줄이 서로 「베낀 문장」으로 잡혔다(본문 문장은 그대로 잰다)."""
    rows = [ln.strip() for ln in (text or "").split("\n")]
    out = list(naver_rules.INTERNAL_URL.findall(text or ""))
    # ③ 한 줄 출처 — 2026-10-20 SUP1: 같은 자료를 인용한 「출처: …」 줄만으로 반려됐다(본문 겹침 0)
    out += [ln for ln in rows if SOURCE_LINE.match(ln)]
    for i, ln in enumerate(rows):
        if SOURCE_HEAD.match(ln):
            out += [r for r in rows[i + 1:] if r]
            break
    return out


def overlap(text, corpus, exempt=(), min_len=20, ratio=OVERLAP_RATIO, k=SHINGLE):
    """이미 쓴 원고와 같은 문장(또는 조각이 ratio 이상 겹치는 문장) → [{sentence, source, ratio}].
    유의문구·소제목처럼 원래 같아야 하는 문장은 exempt 로 뺀다."""
    sh, exact = corpus
    ex = {_norm(e) for e in exempt}
    hits = []
    for s in sentences(text):
        n = _norm(s)
        if len(n) < min_len or any(n in e or e in n for e in ex if e):
            continue
        if n in exact:
            hits.append({"sentence": s, "source": exact[n], "ratio": 1.0})
            continue
        g = shingles(s, k)
        common = [x for x in g if x in sh]
        r = len(common) / len(g) if g else 0
        if r >= ratio:
            hits.append({"sentence": s, "source": sh[common[0]], "ratio": round(r, 2)})
    return hits


# ── 대조 자료 ────────────────────────────────────────────────
def local_docs(out_dir, skip_slug=None):
    docs = []
    if os.path.isdir(THREADS_DIR):
        for dp, _, files in os.walk(THREADS_DIR):
            for f in files:
                if f.endswith(".txt") and f in ("body.txt", "talk.txt"):
                    p = os.path.join(dp, f)
                    docs.append((os.path.relpath(p, ROOT), open(p, encoding="utf-8").read()))
    if os.path.isdir(out_dir):   # 지난 통과 초안 — 같은 문장을 매주 돌려 쓰지 않게
        for name in os.listdir(out_dir):
            d = os.path.join(out_dir, name)
            if not (os.path.isdir(d) and re.match(r"^\d{8}_", name)) or (skip_slug and name.endswith("_" + skip_slug)):
                continue
            for f in ("naver.txt", "main.md"):
                p = os.path.join(d, f)
                if os.path.exists(p):
                    docs.append((f"drafts/{name}/{f}", open(p, encoding="utf-8").read()))
    return docs


def db_docs(env):
    """이미 게시·접수된 원고 — premium_articles 읽기만(GET). 쓰기 없음."""
    import requests
    url, h = kit._rest(env)
    rows = requests.get(url, params={"select": "slug,main_website_markdown,naver_blog_content"}, headers=h, timeout=30).json()
    docs = []
    for r in rows:
        for f in ("naver_blog_content", "main_website_markdown"):
            if r.get(f):
                docs.append((f"DB {r['slug']} {f}", r[f]))
    return docs


# ── 생성 (구독 `claude -p`) ───────────────────────────────────
SOURCES_JSON = os.path.join(ROOT, "configs", "sources.json")


def source_lines(path=SOURCES_JSON, note_max=320):
    """검증된 출처 장부(configs/sources.json — 자료명 정본·증빙 파일 있음) → 프롬프트 줄. 순수에 가깝다(파일 읽기만).
    SUP1(2026-10-20): 장부 없이 생성한 3편이 전부 근거 칸에 [확인: ___] 을 남겨 매일 공급이 「투입 보류」로 끝났다."""
    try:
        rows = json.load(open(path, encoding="utf-8")).get("sources", [])
    except (OSError, json.JSONDecodeError):
        return []
    out = []
    for s in rows:
        pub = s.get("published") or ""
        note = re.sub(r"\s+", " ", s.get("note") or "")[:note_max]
        out.append(f"- {s.get('org')}, {s.get('title')}, {pub[:4]}, {pub} — {note}")
    return out


def build_prompt(topic, cfg, rules_text):
    notices = notice_texts(cfg, topic)
    links = cfg["internal_links"]
    sources = source_lines()
    return f"""너는 23년 차 보험 전문가 신순주의 블로그 원고를 쓰는 작가다. 아래 규칙을 어기면 심의에서 반송된다.

# 금소법 게이트 규칙 (원문)
{rules_text}

# 이 글의 주제
- 분류: {topic['category']}
- 네이버 키워드: {topic['keyword']}
- 각도: {topic['angle']}

# 쓰는 법
- 경어체(~습니다/~입니다). 담담하게. 감정어·과장 금지.
- 각도는 「이미 가입한 계약의 점검·제도 설명」이다. 해지·가입·유지를 권하지 않는다. 리모델링은 갈아타기가 아니다.
- 글의 역할은 「판단에 무엇이 걸려 있는지」 알려 주는 것이다. 독자가 혼자 증권을 꺼내 표를 만들게 하는 단계별 따라하기·「이것만 확인하면 된다」 식 셀프체크로 쓰지 않는다
  (전 계약을 담보 단위로 펼쳐 판단하는 일은 전문가의 몫이라는 점이 문장에 드러나야 한다. 단 상담·문의를 권하는 유인 문장은 쓰지 않는다).
- 확인하지 못한 일반화(「~인 경우가 많아서」로 제도를 단정)를 쓰지 않는다. 약관마다 다르면 다르다고만 쓴다.
- 특정 날짜·특정 고객 일화를 지어내지 않는다. 「상담하다 보면 ~하시는 분이 많습니다」처럼 반복되는 패턴으로만 쓴다.
- 금액(원·만원·억)과 수익률·이율·환급률·공제율 숫자를 쓰지 않는다. 꼭 필요한데 근거 원문을 확인하지 못한 숫자는 [확인: 무엇] 으로 남긴다.
- 보험사·상품명·특약명을 쓰지 않는다. 필요하면 A사·B사(알파벳 순서).
- 상담·문의·카톡·진단 신청 같은 유인 문장, 「무료」, 추천·비교·순위, 다급함 표현을 쓰지 않는다.
- 연락처·이름·직함·경력 숫자를 본문에 쓰지 않는다(필수안내사항은 발행 단계에서 붙는다).
- 아래 유의문구를 네이버판·본진판 본문 끝에 **글자 하나 바꾸지 말고** 각각 한 줄씩 넣는다:
{chr(10).join('  ' + s for s in notices) if notices else '  (이 주제는 추가 유의문구 없음)'}

# 네이버판(naver) 형식 — 기계가 잰다
- naver_title: 30~40자(공백 포함), 「{topic['keyword']}」의 첫 낱말로 시작하고 키워드 낱말을 전부 포함. ' ? " & 금지(질문형은 「~나요」로 끝내고 ? 를 붙이지 않는다).
- 본문 공백 제외 2,600~3,300자. 마크다운 기호 없이 일반 텍스트.
- 표 1개: 「[표1] 표 제목」 한 줄, 바로 아래 「구분 | 항목 | 근거」 머리줄과 「값 | 값 | 값」 줄 2줄 이상(칸은 「 | 」로 나눈다). 표 칸에도 금액을 쓰지 않는다.
- 이미지 자리 5개: 「[이미지①]」~「[이미지⑤]」를 각각 한 줄에 단독으로, 2~3문단마다 하나씩(첫 문단 바로 뒤에 ①). 자리 옆에 다른 글자를 쓰지 않는다.
- 본문 뒤쪽에 「자주 묻는 질문 3가지」 한 줄, 그 아래 「Q. …」 / 「A. …」 3쌍.
- 그 뒤 「핵심 요약」 한 줄, 그 아래 번호 3~4줄.
- 그 뒤 「관련 글」 한 줄, 그 아래 다음 링크 2개를 그대로:
{chr(10).join('  ' + u for u in links)}

# 본진판(main)
- 같은 내용을 마크다운(## 소제목)으로 2,000~3,000자. 네이버판 문장을 그대로 복사하지 말고 다시 쓴다.

# 근거(verify_claims)
- 본문에서 제도·법령을 설명한 문장마다 하나. basis 는 「작성기관명, 자료명(원문 제목 그대로), 기준년도, 발표·개정연도」를 모두 적는다(예: 국가법령정보센터, 소득세법 제59조의4(특별세액공제), 2025.12.23 개정).
- 기사·지식백과·블로그는 근거가 아니다. 원문을 모르면 그 문장을 본문에서 빼거나 [확인: ___] 로 남긴다.
- **아래 「검증된 출처 장부」의 자료를 먼저 쓴다** — 자료명·발표일을 장부 글자 그대로(축약 금지), 쪽·조항은 장부 설명에 있는 것만.
  장부로 뒷받침되지 않는 제도 설명은 본문에서 빼는 쪽을 택한다([확인: ___] 이 남은 원고는 투입되지 않는다).
  · 표준약관 = 보험업감독업무시행세칙 [별표 15], 표준 계약전알릴의무사항 = [별표 14] 표준사업방법서 <부표 1>.

# 검증된 출처 장부 (configs/sources.json — 증빙 원문 보유)
{chr(10).join(sources) if sources else '(장부 없음)'}

# 네이버 사진 5장(naver_images) — 본문 [이미지①~⑤] 자리에 순서대로 들어간다
- ① 썸네일 ② 비교표 ③ 두 칸 대비 ④ 흐름 ⑤ 요점+안내. 사진에도 금액·수익률·보험사명·상담 유인 문구를 쓰지 않는다.
- 사진 글자는 본문에 있는 내용만 줄여 쓴다. 출처 줄(table_note·contrast_note·flow_note)은 verify_claims 의 근거 자료명·날짜만, 없으면 「계약별 증권과 약관 기준」.
- 글자 수(넘치면 사진이 만들어지지 않는다): title 은 줄바꿈(\\n)으로 3줄·한 줄 7자 이내, subtitle 22자, table_rows 는 [항목, col_before 칸, col_after 칸] 3줄·칸마다 12자,
  contrast 는 [[머리, 본문], [머리, 본문]]·머리 10자·본문 40자, flow 는 [[머리, 설명]] 4개·머리 8자·설명 22자, points 3개·18자, 노트는 한 줄 30자로 2줄 이내, cta_line 18자, cta_sub 14자.

# 출력
JSON 객체 하나만 출력한다(코드펜스·설명 금지). 키:
{{"title": 본진 제목, "naver_title": 네이버 제목, "summary": 2문장, "tags": [5개], "key_points": [4개], "faq_json": [{{"question","answer"}} 3개],
  "verify_claims": [{{"claim","basis","confidence"}}], "naver": 네이버판 본문, "main": 본진판 마크다운,
  "naver_images": {{{", ".join(f'"{k}"' for k in IMAGE_KEYS)}}}}}
"""


def visible_api_env():
    return [k for k in API_ENV_KEYS if os.environ.get(k)]


def run_claude(prompt, log_dir, label):
    """구독 실행. 환경에 API 키가 보이면 실행하지 않는다(값은 출력하지 않는다)."""
    seen = visible_api_env()
    if seen:
        raise kit.KitError("환경에 " + " · ".join(seen) + " 가 보인다 — 구독 실행이 유료로 청구될 수 있어 생성하지 않는다")
    if not os.path.isfile(CLAUDE_EXE):
        raise kit.KitError(f"claude 실행 파일이 없다: {CLAUDE_EXE}")
    os.makedirs(log_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(log_dir, f"prompt_{label}_{stamp}.md")
    with open(path, "w", encoding="utf-8") as fp:
        fp.write(prompt + "\n\n파일을 읽거나 쓰지 마라. JSON 객체 하나만 출력해라.")
    env = {k: v for k, v in os.environ.items() if k not in (*API_ENV_KEYS, "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    argv = [CLAUDE_EXE, "-p", f"다음 파일을 읽고 그 지시대로 답해라: {path}", "--output-format", "json", "--permission-mode", "default"]
    p = subprocess.run(argv, cwd=log_dir, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=CLAUDE_TIMEOUT)
    try:
        j = json.loads(p.stdout)
        if j.get("is_error"):
            raise kit.KitError(f"claude -p 실패: {str(j.get('result'))[:300]}")
        return str(j.get("result") or "")
    except json.JSONDecodeError:
        if p.returncode != 0:
            raise kit.KitError(f"claude -p 실패 rc={p.returncode}: {(p.stderr or '')[:300]}")
        return p.stdout


def parse_draft(text):
    s, e = text.find("{"), text.rfind("}")
    if s < 0 or e <= s:
        raise kit.KitError("생성 결과에 JSON 이 없다")
    d = json.loads(text[s:e + 1])
    miss = [k for k in ("title", "naver_title", "summary", "tags", "key_points", "faq_json", "verify_claims", "naver", "main") if not d.get(k)]
    if miss:
        raise kit.KitError("생성 결과에 빠진 값: " + ", ".join(miss))
    return d


# ── 게이트 묶음 ──────────────────────────────────────────────
def to_meta(draft, topic, today):
    return {
        "_주석": f"draft_weekly 초안 {today} — 심의·DB 저장 전. 저장은 draft_insert.py, 접수는 사람.",
        "slug": topic["slug"], "title": draft["title"], "naver_title": draft["naver_title"],
        "naver_keyword": topic["keyword"], "category": DB_CATEGORY[topic["category"]], "seed_key": topic["slug"],
        "summary": draft["summary"], "tags": draft["tags"], "key_points": draft["key_points"],
        "faq_json": draft["faq_json"], "verify_claims": draft["verify_claims"],
    }


def ts_gate(meta_path, naver_path, main_path):
    """#73 check_draft.mts — 금지어·문체·근거. → (통과, 요약 dict)."""
    npx = "npx.cmd" if os.name == "nt" else "npx"
    p = subprocess.run([npx, "--yes", "tsx", os.path.join(ROOT, "scripts", "check_draft.mts"), meta_path, naver_path, main_path],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    try:
        out = json.loads(p.stdout)
    except json.JSONDecodeError:
        return False, {"error": f"check_draft 실행 실패 rc={p.returncode}: {(p.stderr or p.stdout)[:300]}"}
    return ts_verdict(out), out


def ts_verdict(out):
    """check_draft 결과 → 통과 여부. 근거 위반이 전부 [확인: ___] 자리표시(사람이 원문으로 채울 칸) 때문이면 막지 않는다 —
    초안 단계에서 모르는 연도를 지어내게 만들지 않기 위해서다. 채우는 것은 심의 제출 전(§8 근거 게이트), preflight 가 다시 잰다."""
    if out.get("pass"):
        return True
    if out.get("banned", {}).get("level") == "block" or not out.get("style", {}).get("pass", True):
        return False
    bad = [i for i in out.get("evidence", {}).get("issues", []) if i.get("level") == "violation"]
    return bool(bad) and all(CHECK_MARK.search(i.get("basis") or "") for i in bad)


def judge(draft, topic, cfg, corpus, env=None, use_ts=True, tmp_dir=None, today=None):
    """→ {pass, stages:[{name, pass, detail, issues}], placeholders}. 모든 단계를 다 돌려 사유를 한 번에 남긴다."""
    notices = notice_texts(cfg, topic)
    required = preflight.parse_required_notices()
    stages = []

    fin = finance_gate(draft, topic, notices, required)
    stages.append({"name": "금소법 게이트(rules_finance_gate)", "pass": not fin, "issues": fin})

    art = {"title": draft["title"], "naver_title": draft["naver_title"],
           "main_website_markdown": draft["main"], "naver_blog_content": draft["naver"]}
    ok, detail = preflight.check_banned(art)
    stages.append({"name": "금지어(preflight·banned-terms)", "pass": ok, "detail": detail})

    f1, n1 = naver_rules.check_title(draft["naver_title"], topic["keyword"])
    f2, n2 = naver_rules.check_body(draft["naver"], [f"https://goodfinance.kr/news/{topic['slug']}"])
    stages.append({"name": "네이버 규칙 10", "pass": not (f1 + f2), "issues": f1 + f2, "detail": " / ".join(n1 + n2)})

    exempt = notices + required + cfg["internal_links"]
    ov = (overlap(draft["naver"], corpus, exempt + canonical_lines(draft["naver"]))
          + overlap(draft["main"], corpus, exempt + canonical_lines(draft["main"])))
    stages.append({"name": "문장 겹침(게시·접수·지난 초안)", "pass": not ov, "issues": ov})

    if env is not None:
        try:
            topic_guard.guard(env, {"slug": topic["slug"], "title": draft["title"], "naver_title": draft["naver_title"]})
            stages.append({"name": "주제 중복(topic_guard)", "pass": True})
        except kit.KitError as e:
            stages.append({"name": "주제 중복(topic_guard)", "pass": False, "detail": str(e)})
    else:
        stages.append({"name": "주제 중복(topic_guard)", "pass": True, "detail": "미실행(--no-db) — draft_insert 드라이런에서 다시 잰다"})

    if use_ts and tmp_dir:
        paths = write_files(tmp_dir, to_meta(draft, topic, today), draft)
        ok, out = ts_gate(*paths)
        stages.append({"name": "금지어·문체·근거(check_draft.mts)", "pass": ok, "detail": out})
    else:
        stages.append({"name": "금지어·문체·근거(check_draft.mts)", "pass": True, "detail": "미실행(--skip-ts-gate) — 접수 전 반드시 돌린다"})

    # 미실행 단계는 막지 않되 「통과」와 섞이지 않게 따로 적는다 — 접수 전 사람이 다시 돌린다
    return {"pass": all(s["pass"] for s in stages), "stages": stages,
            "unrun": [s["name"] for s in stages if str(s.get("detail", "")).startswith("미실행")],
            "placeholders": placeholders("\n".join([draft["naver"], draft["main"], json.dumps(draft["verify_claims"], ensure_ascii=False)]))}


# ── 저장 ────────────────────────────────────────────────────
def write_files(d, meta, draft, result=None):
    os.makedirs(d, exist_ok=True)
    paths = (os.path.join(d, "meta.json"), os.path.join(d, "naver.txt"), os.path.join(d, "main.md"))
    with open(paths[0], "w", encoding="utf-8", newline="\n") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    for p, k in ((paths[1], "naver"), (paths[2], "main")):
        with open(p, "w", encoding="utf-8", newline="\n") as fp:
            fp.write(draft[k].strip() + "\n")
    if result is not None:
        with open(os.path.join(d, "gate.json"), "w", encoding="utf-8", newline="\n") as fp:
            json.dump(result, fp, ensure_ascii=False, indent=2)
            fp.write("\n")
    return paths


def rejected_entry(when, topic, draft, result):
    lines = [f"\n## {when} — [{topic['category']}] {draft.get('naver_title') or topic['slug']}", f"slug: {topic['slug']}"]
    for s in result["stages"]:
        lines.append(f"{s['name']}: {'통과' if s['pass'] else '반려'}")
        if s["pass"]:
            continue
        for i in s.get("issues") or []:
            if not isinstance(i, dict):
                lines.append(f"  - {i}")
                continue
            why = i.get("reason") or f"겹침 {i.get('ratio')} — {i.get('source')}"
            stage = f"{i['stage']} " if i.get("stage") else ""
            lines.append(f"  - {stage}{why} → \"{i.get('sentence', '')}\"")
        if s.get("detail") and not s.get("issues"):
            d = s["detail"] if isinstance(s["detail"], str) else json.dumps(s["detail"], ensure_ascii=False)[:600]
            lines.append(f"  - {d}")
    return "\n".join(lines) + "\n---\n"


def save(out_dir, topic, draft, result, today, when):
    meta = to_meta(draft, topic, today)
    name = f"{today}_{topic['slug']}"
    if result["pass"]:
        d = os.path.join(out_dir, name)
    else:
        d = os.path.join(out_dir, "_rejected", name)
        with open(os.path.join(out_dir, "_rejected.md"), "a", encoding="utf-8", newline="\n") as fp:
            fp.write(rejected_entry(when, topic, draft, result))
    write_files(d, meta, draft, result)
    if isinstance(draft.get("naver_images"), dict):
        with open(os.path.join(d, "naver_images.json"), "w", encoding="utf-8", newline="\n") as fp:
            json.dump(image_config(draft["naver_images"], topic["slug"]), fp, ensure_ascii=False, indent=2)
            fp.write("\n")
    return d


def image_config(raw, slug):
    """생성 결과 naver_images → naver_images.py 설정(slug·cta_url 은 코드가 채운다). 순수 함수."""
    cfg = {"slug": slug}
    cfg.update({k: raw.get(k) for k in IMAGE_KEYS})
    cfg["cta_url"] = CTA_URL
    return cfg


def image_issues(cfg):
    """사진 설정 검사 → 이슈 목록(비면 통과). 빠진 칸 · 금액·수익률 · 금소법 표현(본문과 같은 정규식). 순수 함수."""
    miss = [k for k in IMAGE_KEYS if not cfg.get(k)]
    if miss:
        return [f"사진 설정 빠진 칸: {', '.join(miss)}"]

    def flat(v):
        if isinstance(v, (list, tuple)):
            return " ".join(flat(x) for x in v)
        return str(v)
    text = flat([cfg[k] for k in IMAGE_KEYS])
    out = []
    if MONEY.search(text):
        out.append(f"사진에 금액 「{MONEY.search(text).group(0)}」")
    if PERCENT.search(text) and RATE_WORD.search(text):
        out.append("사진에 수익률·이율 수치")
    for name, rx in ALWAYS_BANNED:
        m = rx.search(text)
        if m:
            out.append(f"사진에 {name} 「{m.group(0)}」")
    return out


# ── 실행 ────────────────────────────────────────────────────
def generate_one(t, cfg, out_dir, env, rules_text, use_ts=True, from_json=None, today=None):
    """주제 하나: 생성(또는 JSON) → 판정 → 저장. → (저장 폴더, 원고, 판정) · 생성·판정 실패면 (None, None, 사유).
    생성 실패(시간 초과·JSON 깨짐)는 _rejected.md 에만 적고 폴더를 만들지 않는다 — 일시 오류로 주제를 버리지 않게(다음 실행에 다시 고른다)."""
    today = today or datetime.now().strftime("%Y%m%d")
    work = os.path.join(out_dir, "_work")
    when = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    try:
        if from_json:
            draft = parse_draft(open(from_json, encoding="utf-8").read())
        else:
            t0 = time.time()
            draft = parse_draft(run_claude(build_prompt(t, cfg, rules_text), os.path.join(work, "cli"), t["slug"]))
            print(f"  생성 {t['slug']} {time.time() - t0:.0f}초")
        docs = local_docs(out_dir, skip_slug=t["slug"]) + ([] if env is None else db_docs(env))
        result = judge(draft, t, cfg, build_corpus(docs), env, use_ts, os.path.join(work, t["slug"]), today)
    except (kit.KitError, json.JSONDecodeError, subprocess.TimeoutExpired) as e:
        print(f"  ✗ {t['slug']} 생성·판정 실패 — {e}")
        with open(os.path.join(out_dir, "_rejected.md"), "a", encoding="utf-8", newline="\n") as fp:
            fp.write(f"\n## {when} — [{t['category']}] {t['slug']}\n생성·판정 실패: {e}\n---\n")
        return None, None, str(e)
    return save(out_dir, t, draft, result, today, when), draft, result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--count", type=int, default=WEEKLY)
    ap.add_argument("--topic")
    ap.add_argument("--from-json")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--no-db", action="store_true")
    ap.add_argument("--skip-ts-gate", action="store_true")
    a = ap.parse_args()

    cfg = load_topics()
    os.makedirs(a.out, exist_ok=True)
    try:
        topics = pick_topics(cfg, used_slugs(a.out), a.count, a.topic)
    except kit.KitError as e:
        print(str(e))
        sys.exit(2)
    if not topics:
        print("장부의 주제를 모두 썼다 — configs/draft_topics.json 에 주제를 더한다")
        sys.exit(0)
    print("이번 주제:", " · ".join(f"[{t['category']}] {t['slug']}" for t in topics))
    if a.plan:
        return
    if a.from_json and len(topics) != 1:
        print("--from-json 은 --topic 하나와 같이 쓴다")
        sys.exit(2)

    env = None if a.no_db else kit.load_env()
    rules_text = open(RULES_MD, encoding="utf-8").read() if os.path.exists(RULES_MD) else ""
    if not rules_text and not a.from_json:
        print(f"규칙 파일이 없다: {RULES_MD} — 생성하지 않는다")
        sys.exit(2)
    passed = failed = 0
    for t in topics:
        d, draft, result = generate_one(t, cfg, a.out, env, rules_text, use_ts=not a.skip_ts_gate, from_json=a.from_json)
        if d is None:
            failed += 1
            continue
        mark = "통과" if result["pass"] else "반려"
        passed += result["pass"]
        failed += not result["pass"]
        bad = [s["name"] for s in result["stages"] if not s["pass"]]
        print(f"  {'✓' if result['pass'] else '✗'} {mark} {t['slug']} → {d}" + ("" if not bad else "  (" + ", ".join(bad) + ")")
              + ("" if not result["placeholders"] else f"  확인 필요 {len(result['placeholders'])}건")
              + ("" if not result["unrun"] else f"  미실행 게이트 {len(result['unrun'])}개"), flush=True)
    print(f"통과 {passed} · 반려 {failed} — 통과분은 사람이 고른 뒤 draft_insert.py(드라이런 → --insert) → preflight → PAMS")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
