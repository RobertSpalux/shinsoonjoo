#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
지식iN 답변 파이프라인 — 질문 수집 → 답변 초안(게이트) → PAMS 「지식인 심의」 접수 키트 → 승인 후 게시문.

    python scripts/kin_pipeline.py run [--n 3] [--dry-run]     # 수집 + 초안 + 키트(하루 상한 5건)
    python scripts/kin_pipeline.py approvals --xls <jidatexcel.xls>  # PAMS 「지식인&댓글 엑셀변환」으로 승인 수거
    python scripts/kin_pipeline.py approvals                    # (robert-os 감시기 승인 파일이 생기면) 그것으로
    python scripts/kin_pipeline.py approve <키트id> --review-no 2026-10-1234 --from 2026-10-09 --to 2027-10-08 \\
                                           --notice-file <「심의내용」 돋보기 화면 복사본.txt>
    python scripts/kin_pipeline.py posted <키트id> --url <지식iN 답변 URL>
    python scripts/kin_pipeline.py weekly [--profile N] [--kakao N]   # 주간 성적표 한 줄

🔴 이 스크립트가 하지 않는 것
  · PAMS 「저장」「제출」 — 이 파일은 PAMS 에 접속하지 않는다. 「저장」 금지, 「제출」은 로버트만.
    폼 채우기는 robert-os pams_apply 몫이고, 그 전에 jumgumpyoji.jsp?nums=1 의 칸 이름 실측이 필요하다
    (docs/KIN-PIPELINE.md 「robert-os 할 일」). 그때까지 키트 txt 를 보고 사람이 옮겨 넣는다.
  · 네이버 로그인·게시 — 게시는 로버트가 최종본을 복사해 붙여 넣는다.
  · 링크 — 지식iN 답변에는 어떤 URL 도 넣지 않는다(kin-terms 게이트).

키트 위치: %USERPROFILE%\\Downloads\\PAMS접수\\_지식인\\  (🔴 하위 폴더다 — robert-os pams_apply 는 PAMS접수\\*.txt 만
    읽으므로 여기 두면 일반심의 폼으로 잘못 열리지 않는다.)
상태: %LOCALAPPDATA%\\SHIN\\kin_state.json — 키트별 상태(심의대기→승인→게시) · 하루 상한 · 소재 이력.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import kin_harvest  # noqa: E402
import pams_kit as kit  # noqa: E402

ROOT = kit.ROOT
STATE_DIR = kin_harvest.STATE_DIR
STATE_PATH = os.path.join(STATE_DIR, "kin_state.json")
KIT_DIR = os.path.join(kit.KIT_DIR, "_지식인")
APPROVALS_JSON = os.environ.get("KIN_APPROVALS", r"D:\robert-os\finance\state\pams_kin_승인.json")
DAILY_MAX = 5
NOTE_MAX_BYTES = 100      # 특이사항(TB_GUMCHECK_LIST.CHSAYU) — 넘으면 ORA-12899 로 접수 실패(§6.4 스레드 주의 7)
REVIEW_NO_RX = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-\d{4,5}$")   # src/lib/review-no.ts REVIEW_NO_RE 와 같다
DATE_RX = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# PAMS 자동생성 필수안내사항의 자리표시자(매뉴얼 p5·§6.4 스레드 주의 8: 「프라임에셋 심의필 제0000호 (2023.00.00~2024.00.00)」)
PLACEHOLDER_RX = re.compile(r"제\s*0{3,5}\s*호\s*\(\s*\d{4}\.00\.00\s*~\s*\d{4}\.00\.00\s*\)")
# PAMS 지식인 폼 카테고리 라디오 6종(지식인_신청폼.png 실물 2026-10-09): 운전자보험 · 유병자보험 · 종신보험 ·
# 변액/연금보험 · 그외 기타(건강,화재,펫 보험 등) · 태아보험. 고르면 「답변내용」 아래 칸에 안내문구+필수안내사항 자동생성.
# 칸의 name/value 는 아직 재지 않았다 — 글자(라벨)만 적는다.
CATEGORY_ETC = "그외 기타(건강,화재,펫 보험 등)"
CATEGORY = {"간편심사": "유병자보험"}          # 나머지 소재는 전부 CATEGORY_ETC
POSTING_LOCATION = "네이버 지식인"             # 폼 기본값(실물). 고치지 않는다.
NOTICE_MARK = "※ 유의사항"                     # src/lib/compliance/kin-terms.ts KIN_NOTICE_MARK 와 같다


class KinError(Exception):
    pass


# ── 상태 ────────────────────────────────────────────────────
def load_state(path=STATE_PATH):
    try:
        return json.load(open(path, encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"kits": {}}


def save_state(state, path=STATE_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(state, open(path + ".tmp", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(path + ".tmp", path)


# ── 순수 함수(테스트 대상) ─────────────────────────────────────
def pick(candidates, state, today, n):
    """오늘 더 만들 질문. 하루 상한 DAILY_MAX · 같은 소재 하루 1건 · 직전 날 마지막 소재와 연속 금지 · 이미 다룬 질문 제외."""
    kits = state.get("kits", {})
    today_kits = [k for k in kits.values() if k.get("day") == today]
    room = max(0, min(n, DAILY_MAX - len(today_kits)))
    used_topics = {k["topic"] for k in today_kits}
    prev = sorted((k for k in kits.values() if k.get("day", "") < today), key=lambda k: k.get("created", ""))
    if prev:
        used_topics.add(prev[-1]["topic"])
    done_urls = {k["question_url"] for k in kits.values()}
    out = []
    for c in candidates:
        if len(out) >= room:
            break
        if c["url"] in done_urls or c["topic"] in used_topics:
            continue
        out.append(c)
        used_topics.add(c["topic"])
    return out


def special_note(topic):
    """특이사항 칸 — 100바이트 이내. 넘으면 접수가 통째로 실패한다."""
    s = f"지식iN 답변 · {topic} · 링크 없음 · 증빙 해당 없음"
    if len(s.encode("utf-8")) > NOTE_MAX_BYTES:
        s = f"지식iN 답변 · {topic}"
    if len(s.encode("utf-8")) > NOTE_MAX_BYTES:
        raise KinError(f"특이사항이 {NOTE_MAX_BYTES}바이트를 넘는다 — {s}")
    return s


def kit_id(question_url, day):
    m = re.search(r"docId=(\d+)", question_url or "")
    return f"{day.replace('-', '')[4:]}_지식인_{m.group(1) if m else 'x'}"


def compose_answer(body, notice_block):
    return f"{body.strip()}\n\n{notice_block}" if notice_block else body.strip()


def body_part(answer):
    i = answer.find(NOTICE_MARK)
    return answer if i == -1 else answer[:i]


def normalize_review_no(raw):
    """src/lib/review-no.ts normalizeReviewNo 와 같은 규칙 — 번호만(2026-10-1234). 아니면 None."""
    if not isinstance(raw, str):
        return None
    s = re.sub(r"\s+", "", raw)
    s = re.sub(r"\(.*\)$", "", s)
    at = s.rfind("심의필")
    if at >= 0:
        s = s[at + 3:]
    s = re.sub(r"호$", "", re.sub(r"^제", "", s))
    return s if REVIEW_NO_RX.match(s) else None


def fill_notice(notice_text, review_no, f, t):
    """PAMS 자동생성 [안내문구]+[필수안내사항] → 실번호가 든 문구. 다른 글자는 한 글자도 바꾸지 않는다.

    · 자리표시자(「제0000호 (2023.00.00~2024.00.00)」)가 한 곳 있으면 거기에 실번호·실기간만 넣는다.
    · 승인 뒤 「심의내용」 화면·엑셀변환본은 이미 실번호가 들어 있다(매뉴얼 p15) → 그 번호가 맞으면 그대로 쓴다.
    · 둘 다 아니면 멈춘다 — 손으로 채우지 않는다."""
    if not REVIEW_NO_RX.match(review_no or ""):
        raise KinError(f"심의필 번호 형식이 다르다 — 「{review_no}」(번호만, 예: 2026-10-1234)")
    if not (DATE_RX.match(f or "") and DATE_RX.match(t or "")) or f > t:
        raise KinError(f"유효기간 형식·순서가 다르다 — {f}~{t}")
    hits = PLACEHOLDER_RX.findall(notice_text or "")
    if len(hits) == 1:
        return PLACEHOLDER_RX.sub(f"제{review_no}호 ({f.replace('-', '.')}~{t.replace('-', '.')})", notice_text, count=1)
    if not hits and re.search(rf"제\s*{re.escape(review_no)}\s*호", notice_text or ""):
        return notice_text
    raise KinError(f"필수안내사항에서 심의필 자리를 못 정했다(자리표시자 {len(hits)}곳, 실번호 없음) — 손으로 채우지 않고 멈춘다")


def _flat(s):
    return re.sub(r"\s+", "", s or "")


def compose_final(kit_rec, notice_text, review_no, f, t, today):
    """승인 후 게시문.

    · notice_text 가 PAMS 「심의내용」 화면(또는 엑셀변환 「답변내용」)의 **전문**이면 — 그 안에 우리 답변이 이미 있다 —
      그것이 게시문 원본이다(매뉴얼 p15 「해당 내용 복사하여 사용」). 답변이 글자 그대로(공백 무시) 들어 있는지만 보고 그대로 쓴다.
    · 자동생성 [안내문구]+[필수안내사항]만이면 = 심의받은 답변 그대로 + 빈 줄 + 그 문구(실번호).
    """
    answer = kit_rec["answer"]
    if hashlib.sha256(answer.encode("utf-8")).hexdigest() != kit_rec["answer_sha256"]:
        raise KinError("답변이 키트(심의본)와 다르다 — 한 글자라도 바뀌면 신규 심의")
    if not (f <= today <= t):
        raise KinError(f"유효기간 밖({f}~{t})")
    filled = fill_notice(notice_text, review_no, f, t).strip()
    body = _flat(body_part(answer))
    if body and body in _flat(filled):
        return filled
    if _flat(filled)[:40] == body[:40]:
        raise KinError("PAMS 문구가 답변으로 시작하는데 우리 답변과 글자가 다르다 — 심의본이 바뀌었는지 사람이 본다")
    return f"{answer}\n\n{filled}"


KIT_FIELDS = ("심의유형", "손보/생보", "광고형태", "게시위치", "카테고리", "특이사항", "파일첨부", "지식iN 질문", "원고해시")


def kit_text(rec):
    """PAMS 지식인 폼에 옮길 값. 형식 고정(SH4 2026-10-09, test_kin_pipeline 이 지킨다) — robert-os pams_apply 가 읽는다.

    · 1줄: `[PAMS 접수 문자열] 지식인 · <소재> · <키트id>`
    · 그다음 빈 줄까지 = 필드 블록. 줄마다 `<KIT_FIELDS 이름>: <값>` 하나, 순서 고정. **값 뒤에 설명을 붙이지 않는다**
      (본진 키트 「게시위치:」「규격:」 줄과 같은 규칙 — 설명은 아래 「안내」 블록).
    · `── PAMS 에 붙여 넣을 원고 ──` 다음 줄부터 `── 끝 ──` 앞 줄까지 = 「답변내용」 에디터에 넣을 원고(바이트 그대로).
    · 나머지(안내·질문 참고)는 사람용 — 기계는 읽지 않는다.
    폼 칸 순서: 카테고리를 **먼저** 고른다(자동생성 칸이 채워짐) → 원고. 「저장」·「제출」·자가점검은 기계 금지."""
    fields = {
        "심의유형": "지식인",
        "손보/생보": "손보",
        "광고형태": "바이럴(지식in)",
        "게시위치": POSTING_LOCATION,
        "카테고리": rec["category"],
        "특이사항": rec["note"],
        "파일첨부": "없음",
        "지식iN 질문": rec["question_url"],
        "원고해시": f"sha256 {rec['answer_sha256']}",
    }
    return "\n".join([
        f"[PAMS 접수 문자열] 지식인 · {rec['topic']} · {rec['id']}",
        *[f"{k}: {fields[k]}" for k in KIT_FIELDS],
        "",
        "── 안내(사람용) ──",
        "· 폼: jumgumpyoji.jsp?nums=1 — 광고형태 「바이럴(지식in)」·게시위치 「네이버 지식인」은 폼 기본값 그대로.",
        "· 카테고리를 먼저 고른다 → 「답변내용」 아래 칸에 안내문구+필수안내사항이 자동생성된다(지우지 않는다).",
        "· 원고는 텍스트만(이미지 없음). 자가점검은 사람이 확인 후 체크.",
        "· 파일첨부 없음 = 증빙 인용 없음(통계·의학정보·기관 귀속 문장 미사용).",
        "· 「지식iN 질문」은 답변을 달 곳이다(PAMS 칸 아님).",
        "",
        "── 질문 제목(참고) ──",
        rec["question_title"],
        "── 질문 요약(참고 — 검색 API 조각. PAMS 에 넣지 않는다: 질문자 정보 기재 금지 ⑤) ──",
        rec["question_summary"],
        "",
        "── PAMS 에 붙여 넣을 원고 ──",
        rec["answer"],
        "── 끝 ──",
        "",
        "🔴 PAMS 「저장」 금지 · 「제출」은 로버트만. 폼에 직접 고쳐 쓰지 않는다(사용 불가 표현이면 거절 + 작성 내용 삭제).",
        "승인 뒤(둘 중 하나):",
        "  python scripts/kin_pipeline.py approvals --xls <「지식인&댓글 엑셀변환」 jidatexcel.xls>",
        f"  python scripts/kin_pipeline.py approve {rec['id']} --review-no <번호> --from <YYYY-MM-DD> --to <YYYY-MM-DD> "
        "--notice-file <심의내용 돋보기 화면 복사본.txt>",
    ]) + "\n"


def weekly_line(state, today, profile=None, kakao=None):
    """주간 성적표 한 줄 — 지난 7일. 프로필 조회·카톡은 API 가 없어 사람이 넣는다(없으면 「미입력」).
    사이트 방문은 지식iN 답변에 링크가 없어 답변 단위로 귀속할 수 없다 → 「측정 불가」로 적는다(지어내지 않는다)."""
    start = (date.fromisoformat(today) - timedelta(days=7)).isoformat()
    recent = [k for k in state.get("kits", {}).values() if k.get("day", "") > start]
    approved = [k for k in recent if k.get("status") in ("승인", "게시")]
    posted = [k for k in recent if k.get("status") == "게시"]

    def fmt(v):
        return "미입력" if v is None else str(v)
    return (f"지식iN 주간({start[5:]}~{today[5:]}): 질문 {len(recent)} → 심의승인 {len(approved)} → 답변 게시 {len(posted)}"
            f" → 프로필 조회 {fmt(profile)} / 사이트 방문 측정 불가(링크 없음) / 카톡 {fmt(kakao)}")


# ── 게이트·초안(외부 호출) ────────────────────────────────────
def _tsx(script, payload):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False)
        tmp = fp.name
    try:
        r = subprocess.run(f'npx tsx {script} "{tmp}"', cwd=ROOT, shell=True, capture_output=True,
                           text=True, encoding="utf-8")
        if not r.stdout.strip():
            raise KinError(f"{script} 실행 실패 — {r.stderr.strip()[:300]}")
        return json.loads(r.stdout.strip().splitlines()[-1])
    finally:
        os.unlink(tmp)


def gate(items):
    """[{answer, question}] → [{pass, bodyLength, findings}]"""
    return _tsx("scripts/check_kin.mts --batch", items)


def notice_blocks(items):
    """[{body, question}] → [유의문구 블록] — 정본 자구는 brand.ts(kin-terms.kinNoticeBlock)가 만든다."""
    return _tsx("scripts/check_kin.mts --notice", items)


def draft(items):
    """[{id, title, body, feedback?}] → [{id, text}|{id, error}]"""
    return _tsx("scripts/kin_draft.mts", items)


def make_answers(cands, draft_fn=draft, gate_fn=gate, notice_fn=notice_blocks, tries=2):
    """후보 → [(후보, 답변 전문 | None, 막힌 사유)]. 게이트에 걸리면 사유를 붙여 처음부터 한 번 더 쓴다(고쳐 쓰지 않는다)."""
    pending = {c["url"]: c for c in cands}
    feedback, result = {}, {}
    for _ in range(tries):
        if not pending:
            break
        reqs = [{"id": u, "title": c["title"], "body": c["summary"], **({"feedback": feedback[u]} if u in feedback else {})}
                for u, c in pending.items()]
        drafts = {d["id"]: d for d in draft_fn(reqs)}
        for u in list(pending):
            if not drafts.get(u, {}).get("text"):
                result[u] = (None, f"초안 실패: {drafts.get(u, {}).get('error', '응답 없음')}")
                pending.pop(u)
        ok_items = [(u, drafts[u]["text"]) for u in pending]
        if not ok_items:
            break
        q = {u: pending[u]["title"] + "\n" + pending[u]["summary"] for u, _ in ok_items}
        blocks = notice_fn([{"body": t, "question": q[u]} for u, t in ok_items])
        answers = [(u, compose_answer(t, b)) for (u, t), b in zip(ok_items, blocks)]
        verdicts = gate_fn([{"answer": a, "question": q[u]} for u, a in answers])
        for (u, a), v in zip(answers, verdicts):
            if v["pass"]:
                result[u] = (a, "")
                pending.pop(u)
            else:
                why = "; ".join(f"{f['rule']}: {f['term']}" for f in v["findings"])
                feedback[u] = why
                result[u] = (None, f"게이트: {why}")
    return [(c, *result.get(c["url"], (None, "처리 안 됨"))) for c in cands]


# ── DB ──────────────────────────────────────────────────────
def _rest(env, table):
    url, h = kit._rest(env)
    return url.rsplit("/", 1)[0] + "/" + table, h


def save_draft_row(env, rec):
    """kin_answers 에 「초안」으로 — 어드민 지식iN 탭에 그대로 보인다. 실패해도 키트는 남긴다."""
    url, h = _rest(env, "kin_answers")
    r = requests.post(url, json={"question_url": rec["question_url"], "question_title": rec["question_title"],
                                 "question_body": rec["question_summary"] or rec["question_title"],
                                 "answer_draft": rec["answer"], "status": "초안"},
                      headers={**h, "Content-Type": "application/json", "Prefer": "return=representation"}, timeout=30)
    if r.status_code >= 300:
        return None, f"kin_answers 기록 실패 HTTP {r.status_code}"
    return r.json()[0]["id"], "kin_answers 초안"


def record_review(env, rec, review_no, f, t):
    """ad_reviews 에 channel='kin' 행. 🔴 article_id 가 NOT NULL·FK 라 지식인 답변(글이 아님)은 지금 넣을 수 없다
    (2026-10-09 OpenAPI 실측). sql/006_ad_reviews_kin.sql 적용 전에는 실패를 돌려주고 상태 파일에만 남긴다."""
    url, h = _rest(env, "ad_reviews")
    # channel='kin' = 지식iN 행의 유일한 식별 키(sql/006 체크·NOT_KIN 필터). review_type 은 PAMS 심의유형 — 기존 값 'jisikin'
    # (src/app/api/admin/ad-review/route.ts REVIEW_TYPES). 'kin' 은 review_type 체크에 없다.
    body = {"channel": "kin", "review_type": "jisikin", "ad_form": "바이럴(지식in)", "status": "approved",
            "posting_title": POSTING_LOCATION, "review_authority": "프라임에셋",
            "review_no": review_no, "review_from": f, "review_to": t,
            "reviewed_at": datetime.now(kit.KST).isoformat(),
            "notes": f"지식iN 답변 {rec['id']} · 질문 {rec['question_url']} · 원고 sha256 {rec['answer_sha256']}"}
    if not rec.get("kin_answer_id"):
        # sql/006 체크(ad_reviews_article_or_kin)가 kin 행에 kin_answer_id 를 요구한다 — 초안 행 기록이 실패한 키트
        return None, "ad_reviews 기록 못함 — kin_answers 초안 행이 없다(run 때 기록 실패). 상태 파일에만 남김"
    body["kin_answer_id"] = rec["kin_answer_id"]
    r = requests.post(url, json=body, headers={**h, "Content-Type": "application/json",
                                               "Prefer": "return=representation"}, timeout=30)
    if r.status_code >= 300:
        return None, f"ad_reviews 기록 못함(HTTP {r.status_code}) — sql/006 미적용이면 정상. 상태 파일에만 남김"
    return r.json()[0]["id"], "ad_reviews kin 행"


def set_posted_url(env, rec):
    msgs = []
    if rec.get("ad_review_id"):
        url, h = _rest(env, "ad_reviews")
        r = requests.patch(url, params={"id": f"eq.{rec['ad_review_id']}"}, json={"posted_url": rec["posted_url"]},
                           headers={**h, "Content-Type": "application/json", "Prefer": "return=minimal"}, timeout=30)
        msgs.append(f"ad_reviews posted_url {'기록' if r.status_code < 300 else f'실패 {r.status_code}'}")
    if rec.get("kin_answer_id"):
        url, h = _rest(env, "kin_answers")
        r = requests.patch(url, params={"id": f"eq.{rec['kin_answer_id']}"},
                           json={"status": "게시완료", "posted_at": datetime.now(kit.KST).isoformat()},
                           headers={**h, "Content-Type": "application/json", "Prefer": "return=minimal"}, timeout=30)
        msgs.append(f"kin_answers 게시완료 {'기록' if r.status_code < 300 else f'실패 {r.status_code}'}")
    return msgs


# ── 엑셀변환(승인 수거) ──────────────────────────────────────
def _html_rows(text):
    """PAMS 엑셀변환(jidatexcel.xls) — JSP 가 내려주는 .xls 는 대개 HTML 표다. 셀 글자만 모은다."""
    from html.parser import HTMLParser
    rows, cur, cell, st = [], [], [], {"in": False}

    class P(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag in ("td", "th"):
                st["in"] = True
                cell.clear()
            elif tag == "br" and st["in"]:
                cell.append("\n")
            elif tag == "tr":
                cur.clear()

        def handle_endtag(self, tag):
            if tag in ("td", "th"):
                st["in"] = False
                cur.append("".join(cell).strip())
            elif tag == "tr" and cur:
                rows.append(list(cur))

        def handle_data(self, data):
            if st["in"]:
                cell.append(data)

    P().feed(text)
    return rows


def read_export(path):
    """「지식인&댓글 엑셀변환」 → [{No, 신청일시, 변경일시, 심의필번호, 심의필일자, 광고유효기간, 답변내용}].
    양식(지식인댓글_엑셀변환_양식.png 실물 jidatexcel.xls): No · 신청일시 · 변경일시 · 심의필번호 · 심의필일자 · 광고유효기간 · 답변내용."""
    raw = open(path, "rb").read()
    if raw[:4] == b"PK\x03\x04":
        from openpyxl import load_workbook
        ws = load_workbook(path, read_only=True).active
        rows = [[("" if v is None else str(v)) for v in r] for r in ws.iter_rows(values_only=True)]
    elif b"<table" in raw[:8192].lower() or raw[:512].lstrip().startswith(b"<"):
        text = None
        for enc in ("utf-8-sig", "cp949"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise KinError("엑셀변환 파일 인코딩을 못 읽었다(utf-8·cp949 아님)")
        rows = _html_rows(text)
    else:
        try:
            import xlrd
        except ImportError:
            raise KinError("구형 .xls(BIFF) 다 — xlrd 가 없다. 엑셀에서 「다른 이름으로 저장 → .xlsx」 한 뒤 다시")
        sh = xlrd.open_workbook(path).sheet_by_index(0)
        rows = [[str(c.value) for c in sh.row(i)] for i in range(sh.nrows)]
    hdr_i = next((i for i, r in enumerate(rows) if "심의필번호" in [c.replace(" ", "") for c in r]), None)
    if hdr_i is None:
        raise KinError("엑셀변환 파일에서 「심의필번호」 머리줄을 못 찾았다")
    hdr = [c.replace(" ", "") for c in rows[hdr_i]]
    return [dict(zip(hdr, r)) for r in rows[hdr_i + 1:] if any(x.strip() for x in r)]


def _date(s):
    m = re.search(r"(\d{4})[-.](\d{1,2})[-.](\d{1,2})", s or "")
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else ""


def _period(row):
    """시작 = 심의필일자, 끝 = 광고유효기간(끝날짜만이거나 「시작 ~ 끝」)."""
    ds = re.findall(r"\d{4}[-.]\d{1,2}[-.]\d{1,2}", row.get("광고유효기간") or "")
    f = _date(row.get("심의필일자")) or (_date(ds[0]) if len(ds) > 1 else "")
    t = _date(ds[-1]) if ds else ""
    return f, t


def match_export(rows, kits):
    """엑셀 행 ↔ 우리 키트(심의대기) — 답변내용 안에 키트 답변 본문이 글자 그대로(공백 무시) 들어 있는 것만 짝."""
    out = []
    for row in rows:
        no = normalize_review_no(row.get("심의필번호") or "")
        if not no:
            continue   # 아직 심사중·반송
        flat = _flat(row.get("답변내용"))
        hits = [k for k in kits if k.get("status") == "심의대기" and _flat(body_part(k["answer"])) in flat]
        if len(hits) == 1:
            out.append((hits[0]["id"], no, *_period(row), row.get("답변내용") or ""))
    return out


# ── 명령 ────────────────────────────────────────────────────
def notify_fn(env, dry):
    if dry:
        return lambda t: print("[알림 생략 — dry-run]\n" + t)
    import pams_auto
    return lambda t: pams_auto.telegram(env, t)


def cmd_run(env, n, dry, harvest_fn=None, make_fn=make_answers, notify=None, state_path=STATE_PATH,
            kit_dir=KIT_DIR, save_row=save_draft_row, now=None):
    now = now or datetime.now(kit.KST)
    today = now.date().isoformat()
    state = load_state(state_path)
    res = (harvest_fn or (lambda: kin_harvest.collect(env, now=now)))()
    chosen = pick(res["candidates"], state, today, n)
    lines = [f"지식iN 수집: 질문 {res['seen_total']} · 후보 {len(res['candidates'])} · 제외 {len(res['excluded'])}"
             + (" · 첫 실행 기준선" if res.get("baseline") else "") + f" · 오늘 만들 것 {len(chosen)}"]
    made = []
    for c, answer, why in (make_fn(chosen) if chosen else []):
        if not answer:
            lines.append(f"✖ [{c['topic']}] {c['title'][:40]} — {why[:300]}")
            continue
        rec = {"id": kit_id(c["url"], today), "day": today, "created": now.isoformat(), "topic": c["topic"],
               "question_url": c["url"], "question_title": c["title"], "question_summary": c["summary"],
               "answer": answer, "answer_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest(),
               "category": CATEGORY.get(c["topic"], CATEGORY_ETC),
               "note": special_note(c["topic"]), "status": "심의대기"}
        if not dry:
            rec["kin_answer_id"], _ = save_row(env, rec)
            os.makedirs(kit_dir, exist_ok=True)
            path = os.path.join(kit_dir, rec["id"] + ".txt")
            open(path, "w", encoding="utf-8", newline="\n").write(kit_text(rec))
            rec["kit"] = path
            state["kits"][rec["id"]] = rec
        made.append(rec)
        lines.append(f"✅ [{c['topic']}] {c['title'][:40]} → {rec['id']} (본문 {len(body_part(answer).strip())}자)")
    if not dry:
        save_state(state, state_path)
    if made:
        (notify or notify_fn(env, dry))(
            f"🙋 지식인 심의 접수 대기 {len(made)}건 — PAMS 지식인 심의에 옮긴 뒤 「제출」은 로버트가(저장 금지)\n"
            + "\n".join(f"· {r['id']} [{r['topic']}] {r['question_title'][:30]}" for r in made)
            + f"\n키트: {kit_dir}")
    return lines, made


def cmd_approve(env, kid, review_no, f, t, notice_text, notify=None, state_path=STATE_PATH, record=record_review,
                today=None, dry=False, kit_dir=KIT_DIR):
    state = load_state(state_path)
    rec = state["kits"].get(kid)
    if not rec:
        raise KinError(f"키트 {kid} 가 상태 파일에 없다")
    review_no = normalize_review_no(review_no) or review_no   # 형식이 틀리면 fill_notice 가 멈춘다
    final = compose_final(rec, notice_text, review_no, f, t, today or date.today().isoformat())
    rec.update({"status": "승인", "review_no": review_no, "review_from": f, "review_to": t,
                "notice_text": notice_text, "final": final})
    if not dry:
        rec["ad_review_id"], rec["ad_review_msg"] = record(env, rec, review_no, f, t)
        out = os.path.join(kit_dir, kid + "_게시본.txt")
        os.makedirs(kit_dir, exist_ok=True)
        open(out, "w", encoding="utf-8", newline="\n").write(final + "\n")
        rec["final_path"] = out
        save_state(state, state_path)
    (notify or notify_fn(env, dry))(
        f"✅ 지식인 심의 승인 {kid} — 제{review_no}호. 아래를 그대로 복사해 지식iN 답변에 붙여 넣어 주세요"
        f"(게시 뒤 URL 을 알려 주시면 PAMS 게시위치·기록에 씁니다).\n질문: {rec['question_url']}\n\n{final}")
    return rec


def cmd_posted(env, kid, url, state_path=STATE_PATH, setter=set_posted_url):
    state = load_state(state_path)
    rec = state["kits"].get(kid)
    if not rec:
        raise KinError(f"키트 {kid} 가 상태 파일에 없다")
    if rec.get("status") != "승인":
        raise KinError(f"승인 전 키트다(상태 {rec.get('status')})")
    if not re.match(r"^https://(?:m\.)?kin\.naver\.com/", url or ""):
        raise KinError(f"지식iN 주소가 아니다 — {url}")
    rec.update({"status": "게시", "posted_url": url, "posted_at": datetime.now(kit.KST).isoformat()})
    msgs = setter(env, rec)
    save_state(state, state_path)
    return msgs


def cmd_approvals(env, xls=None, path=APPROVALS_JSON, state_path=STATE_PATH, notify=None, record=record_review,
                  today=None, kit_dir=KIT_DIR):
    """승인 수거 — ① PAMS 「지식인&댓글 엑셀변환」 파일(--xls) ② robert-os 감시기 승인 파일(계약은 docs/KIN-PIPELINE.md)."""
    state = load_state(state_path)
    if xls:
        items = match_export(read_export(xls), list(state["kits"].values()))
    elif os.path.exists(path):
        items = [(kid, a.get("심의필번호", ""), _date(a.get("시작")), _date(a.get("종료")), a.get("답변내용", ""))
                 for kid, a in (json.load(open(path, encoding="utf-8")) or {}).items()]
    else:
        return ["승인 파일 없음 — --xls 로 엑셀변환본을 주거나 approve 를 손으로"]
    out = []
    for kid, no, f, t, text in items:
        rec = state["kits"].get(kid)
        if not rec or rec.get("status") != "심의대기":
            continue
        try:
            cmd_approve(env, kid, no, f, t, text, notify=notify, state_path=state_path, record=record,
                        today=today, kit_dir=kit_dir)
            out.append(f"승인 처리 {kid} — 제{normalize_review_no(no) or no}호")
        except KinError as e:
            out.append(f"승인 처리 실패 {kid}: {e}")
    return out or ["새 승인 없음"]


def main():
    ap = argparse.ArgumentParser(description="지식iN 답변 파이프라인")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--n", type=int, default=3)
    r.add_argument("--dry-run", action="store_true")
    a = sub.add_parser("approve")
    a.add_argument("kit")
    a.add_argument("--review-no", required=True)
    a.add_argument("--from", dest="f", required=True)
    a.add_argument("--to", dest="t", required=True)
    a.add_argument("--notice-file", required=True)
    a.add_argument("--dry-run", action="store_true")
    ap_ = sub.add_parser("approvals")
    ap_.add_argument("--xls", help="PAMS 「지식인&댓글 엑셀변환」 내려받은 파일")
    p = sub.add_parser("posted")
    p.add_argument("kit")
    p.add_argument("--url", required=True)
    w = sub.add_parser("weekly")
    w.add_argument("--profile", type=int)
    w.add_argument("--kakao", type=int)
    args = ap.parse_args()
    env = kit.load_env()
    try:
        if args.cmd == "run":
            lines, _ = cmd_run(env, args.n, args.dry_run)
            print("\n".join(lines))
        elif args.cmd == "approve":
            notice = open(args.notice_file, encoding="utf-8-sig").read()
            rec = cmd_approve(env, args.kit, args.review_no, args.f, args.t, notice, dry=args.dry_run)
            print(rec.get("final_path") or rec["final"])
        elif args.cmd == "approvals":
            print("\n".join(cmd_approvals(env, xls=args.xls)))
        elif args.cmd == "posted":
            print("\n".join(cmd_posted(env, args.kit, args.url)))
        elif args.cmd == "weekly":
            print(weekly_line(load_state(), date.today().isoformat(), args.profile, args.kakao))
    except KinError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
