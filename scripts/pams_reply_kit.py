#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
스레드 답글 댓글심의 접수 정리표 — 로버트가 PAMS 댓글심의 폼에 한 건씩 옮겨 넣는다.

    python scripts/pams_reply_kit.py --input <답글.json>
    python scripts/pams_reply_kit.py --from-replies D:\\robert-os\\finance\\state\\replies.json [--status 초안] [--record]
    옵션: --out-dir <폴더>  --date MMDD  --dry-run(파일 안 쓰고 요약만)
          --record: 게이트 통과분을 reply_reviews 표에 「초안」으로 적는다(표가 아직 없으면 알리고 넘어간다 — sql/005)

입력(--input): [{"post_url": 원글 URL, "comment": 댓글 원문, "reply": 답글 원고, "comment_url": 댓글 링크(선택)}]
입력(--from-replies): robert-os reply_bot 기록. 계정=goodfinance · 초안 있음 · 상태=--status 인 것만.
    [2026-10-01 관제탑] 상태 이름 정본 = reply_bot. 기본값을 「초안」으로 바꿨다(전에는 reply_bot 에 없는 「승인」이라 늘 0건).
    상태 흐름(reply_bot · reply_reviews 공통): 초안 → 심의대기 → 승인 → 답함 (반송 · 취소는 옆길).

심의본 = 게시본: 답글 원고의 sha256(UTF-8, 글자 그대로)을 정리표 「원고해시」 칸과 reply_reviews.reply_sha256 에 남긴다.
    게시 직전에는 posting_verdict() 로 「승인 · 심의필 · 유효기간 안 · 해시 일치」를 모두 확인한다 —
    robert-os reply_bot.답글보내기 게이트가 이 판정과 같아야 한다(tmp/relay/reply_gate_patch.md).

산출: %USERPROFILE%\\Downloads\\PAMS접수\\_댓글심의\\MMDD_댓글_N건.xlsx (N = 게이트 통과 건수)
    시트 「접수」 — 게이트 통과분만. 시트 「막힘」 — 걸린 것과 사유(접수하지 않는다).

🔴 이것은 **PAMS 업로드 양식이 아니다.** PAMS 「지식인&댓글 엑셀변환」(gumexcel.jsp)은 목록 **내려받기**이고
   업로드 경로가 없다(CLAUDE.md §6.3, robert-os shared/data/pams_form_map.md). 댓글심의는 폼(jumgumpyoji.jsp?nums=2)에
   **한 건씩 직접 입력**한다. 이 표는 그 입력을 위한 정리표다. 폼의 칸 이름·카테고리 목록은 아직 실측되지 않았다
   (pams_form_map.md 「jumgumpyoji.jsp 미확인」) — 실측되면 열 이름을 폼 칸에 맞춘다.
🔴 게이트: scripts/check_reply.mts(= src/lib/compliance/reply-terms.ts). 하나라도 걸리면 「막힘」 시트로 간다 —
   댓글심의는 사용 불가 표현이 있으면 자동 거절 + 작성 내용 초기화다.
🔴 댓글 원문은 참고용이다 — PAMS 에 넣지 않는다. 전화번호는 가려서 적는다(개인정보).
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KST = timezone(timedelta(hours=9))
OUT_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "PAMS접수", "_댓글심의")
PROFILE = "https://www.threads.com/@goodfinance_sj"
BODY_MAX = 500  # 스레드 글자 한도 — 답글 + 필수안내가 넘으면 필수안내는 이미지(§6.4 스레드 주의사항 6)
NOTE_MAX_BYTES = 100  # 특이사항 칸(TB_GUMCHECK_LIST.CHSAYU) — 넘으면 ORA-12899 로 접수 실패
PHONE_RX = re.compile(r"0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}")

COLUMNS = ["번호", "원글 URL(게시위치)", "댓글 링크", "댓글 원문(참고 — PAMS 입력 금지)", "답글 원고(답변내용 앞부분)",
           "글자수", "카테고리(PAMS 선택)", "특이사항(100바이트 이내)", "심의필번호(승인 후)", "유효기간(승인 후)", "게시 URL(게시 후)",
           "원고해시(sha256 앞 12자)"]
STATUSES = ("초안", "심의대기", "승인", "반송", "답함", "취소")   # reply_bot 정본 = sql/005 reply_reviews_status_chk
REVIEW_NO_RX = re.compile(r"^\d{4}-\d{2}-\d{1,5}$")


def reply_hash(text):
    """답글 원고의 sha256 — 글자 그대로(UTF-8). 공백·줄바꿈 하나라도 다르면 다른 원고다(DB 트리거와 같은 계산)."""
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def posting_verdict(row, text, today):
    """게시 직전 판정 → (보낼까, 사유). row = reply_reviews 한 행(dict), text = 보내려는 답글 본문(필수안내 제외), today = 'YYYY-MM-DD'.
    🔴 하나라도 아니면 보내지 않는다: 승인 · 심의필 형식 · 유효기간 안 · 필수안내 원문 있음 · 심의본 해시 일치 · 아직 안 보냄."""
    if not row:
        return False, "reply_reviews 에 기록이 없다 — 댓글심의를 받지 않은 답글이다"
    st = row.get("status")
    if st == "답함" or row.get("posted_reply_id"):
        return False, "이미 보냈다"
    if st != "승인":
        return False, f"승인 전(상태 {st}) — PAMS 댓글심의 승인 뒤에만 보낸다"
    if not REVIEW_NO_RX.match((row.get("review_no") or "").strip()):
        return False, "심의필 번호가 없거나 형식이 다르다"
    f, t = str(row.get("review_from") or ""), str(row.get("review_to") or "")
    if not f or not t or not (f <= today <= t):
        return False, f"유효기간 밖({f}~{t})"
    if not (row.get("notice_text") or "").strip():
        return False, "PAMS 가 만든 필수안내사항 원문이 없다 — 붙일 수 없다"
    if reply_hash(text) != row.get("reply_sha256"):
        return False, "심의본과 다르다 — 한 글자라도 바뀌면 신규 심의"
    return True, ""


def compose_post(row):
    """실제로 보낼 글 = 승인된 답글 원고 + 빈 줄 + PAMS 자동 생성 [안내문구]+[필수안내사항](승인본 글자 그대로).
    500자를 넘으면 필수안내는 이미지로 게시해야 한다(§6.4 스레드 주의사항 6) → 이 함수는 멈추고 사람에게 넘긴다."""
    body = f"{row['reply_text']}\n\n{row['notice_text'].strip()}"
    if len(body) > BODY_MAX:
        raise KitError(f"답글+필수안내 {len(body)}자 > {BODY_MAX}자 — 필수안내를 이미지로 붙여야 한다(자동 게시 금지)")
    return body


class KitError(Exception):
    pass


def mask_phone(text):
    return PHONE_RX.sub(lambda m: m.group(0)[:3] + "-****-****", text or "")


def from_replies(path, status="초안"):
    d = json.load(open(path, encoding="utf-8"))
    out = []
    for cid, c in (d.get("댓글") or {}).items():
        if c.get("계정") != "goodfinance" or not c.get("초안") or c.get("상태") != status:
            continue
        short = c.get("뿌리글_짧은")
        out.append({"post_url": f"{PROFILE}/post/{short}" if short else PROFILE, "comment": c.get("글") or "",
                    "reply": c["초안"], "comment_url": c.get("링크") or "", "id": cid, "root_post_id": c.get("뿌리글") or ""})
    return out


def gate(items):
    """reply-terms 게이트를 한 번에 돌린다 — [{pass, findings}]."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fp:
        json.dump([{"reply": it["reply"], "comment": it.get("comment", "")} for it in items], fp, ensure_ascii=False)
        tmp = fp.name
    try:
        r = subprocess.run(f'npx tsx scripts/check_reply.mts --batch "{tmp}"', cwd=ROOT, shell=True,
                           capture_output=True, text=True, encoding="utf-8")
        if r.returncode not in (0, 1) or not r.stdout.strip():
            raise KitError(f"게이트 실행 실패 — {r.stderr.strip()[:300]}")
        return json.loads(r.stdout.strip().splitlines()[-1])
    finally:
        os.unlink(tmp)


def build(items, out_dir=OUT_DIR, date=None, dry_run=False):
    if not items:
        raise KitError("답글이 없습니다")
    for i, it in enumerate(items, 1):
        if not (it.get("reply") or "").strip():
            raise KitError(f"{i}번 답글이 비었습니다")
    results = gate(items)
    ok_rows, blocked = [], []
    for it, res in zip(items, results):
        if res["pass"] and len(it["reply"]) <= BODY_MAX:
            ok_rows.append(it)
        else:
            why = [f"{f['rule']}: {f['term']}" for f in res["findings"]]
            if len(it["reply"]) > BODY_MAX:
                why.append(f"길이 {len(it['reply'])}자 > {BODY_MAX}자")
            blocked.append((it, why))
    date = date or datetime.now(KST).strftime("%m%d")
    path = os.path.join(out_dir, f"{date}_댓글_{len(ok_rows)}건.xlsx")
    summary = {"xlsx": path, "접수": len(ok_rows), "막힘": len(blocked),
               "막힘사유": [{"reply": it["reply"], "사유": why} for it, why in blocked],
               "_통과": ok_rows}
    if dry_run:
        return summary

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    wb = Workbook()
    ws = wb.active
    ws.title = "접수"
    ws.append(COLUMNS)
    for n, it in enumerate(ok_rows, 1):
        ws.append([n, it.get("post_url") or PROFILE, it.get("comment_url", ""), mask_phone(it.get("comment", "")),
                   it["reply"], len(it["reply"]), "", "", "", "", "", reply_hash(it["reply"])[:12]])
    bs = wb.create_sheet("막힘")
    bs.append(["번호", "답글 원고", "사유(게이트)"])
    for n, (it, why) in enumerate(blocked, 1):
        bs.append([n, it["reply"], " / ".join(why)])
    guide = wb.create_sheet("안내")
    for line in [
        "PAMS 업로드 양식 아님 — 댓글심의 폼(jumgumpyoji.jsp?nums=2)에 한 건씩 직접 입력하는 정리표.",
        "심의유형 「댓글심의」 · 광고 구분 「업무광고」. 카테고리를 고르면 「답변내용」 칸에 안내문구+필수안내사항이 자동 생성된다.",
        "답글 원고를 자동 생성본 앞에 붙인다. 폼에 직접 쓰지 않는다(사용 불가 표현 시 초기화).",
        f"특이사항은 {NOTE_MAX_BYTES}바이트(한글 약 40자) 이내 — 넘으면 ORA-12899 로 접수 실패.",
        "댓글심의는 [심사중] 3건 한도 밖, 통상 1시간 내 승인. 승인 후 심의필번호·유효기간을 이 표에 적고 게시한다.",
        "게시는 승인된 원문 그대로(오타 포함 수정 금지) + 자동 생성 필수안내. 게시 후 PAMS 게시위치 등록.",
        "댓글 원문 칸은 참고용 — PAMS 에 넣지 않는다(질문자 개인정보, §6.10 댓글심의 ⑤).",
    ]:
        guide.append([line])
    for sheet in (ws, bs):
        for col in sheet.columns:
            sheet.column_dimensions[col[0].column_letter].width = 18
            for c in col:
                c.alignment = Alignment(wrap_text=True, vertical="top")
        for c in sheet[1]:
            c.font = Font(bold=True)
    ws.column_dimensions["E"].width = 60
    guide.column_dimensions["A"].width = 120
    os.makedirs(out_dir, exist_ok=True)
    wb.save(path + ".part")
    os.replace(path + ".part", path)
    return summary


def record_rows(items):
    """게이트 통과분 → reply_reviews 행(초안). 순수 — DB 에 쓰는 것은 record()."""
    rows = []
    for it in items:
        if not it.get("id") or not it.get("root_post_id"):
            continue   # --input 목록처럼 댓글 id·뿌리글 id 가 없으면 기록하지 않는다(정리표만)
        rows.append({"account": "goodfinance", "root_post_id": it["root_post_id"], "root_post_url": it.get("post_url"),
                     "comment_id": it["id"], "comment_url": it.get("comment_url") or None,
                     "reply_text": it["reply"], "status": "초안"})
    return rows


def record(items, post=None):
    """reply_reviews 에 초안으로 적는다. 같은 댓글·같은 원고는 한 번만(on_conflict comment_id,reply_sha256 — sql/005).
    표가 아직 없으면(마이그레이션 미적용) 알리고 0을 돌려준다 — 정리표 만들기를 막지 않는다."""
    rows = record_rows(items)
    if not rows:
        return 0, "기록할 행 없음"
    if post is None:
        import requests
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import pams_kit as kit
        url, h = kit._rest(kit.load_env())
        target = url.rsplit("/", 1)[0] + "/reply_reviews?on_conflict=comment_id,reply_sha256"
        for r in rows:
            r["reply_sha256"] = reply_hash(r["reply_text"])   # 트리거가 다시 계산한다(충돌 판정용으로만 미리 넣음)

        def post(rs):
            return requests.post(target, json=rs, headers={**h, "Content-Type": "application/json",
                                                           "Prefer": "resolution=ignore-duplicates,return=minimal"}, timeout=30)
    r = post(rows)
    if r.status_code == 404 or "PGRST205" in (r.text or "") or "does not exist" in (r.text or ""):
        return 0, "reply_reviews 표가 아직 없다(sql/005 미적용) — 정리표만 만들었다"
    if r.status_code >= 300:
        raise KitError(f"reply_reviews 기록 실패 — {r.status_code} {r.text[:200]}")
    return len(rows), f"reply_reviews 에 초안 {len(rows)}건"


def main():
    ap = argparse.ArgumentParser(description="스레드 답글 댓글심의 접수 정리표")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", help="답글 목록 JSON")
    src.add_argument("--from-replies", help="robert-os finance/state/replies.json")
    ap.add_argument("--status", default="초안", choices=STATUSES, help="--from-replies 에서 고를 상태(기본 초안 — reply_bot 정본)")
    ap.add_argument("--record", action="store_true", help="게이트 통과분을 reply_reviews 에 초안으로 적는다")
    ap.add_argument("--out-dir", default=OUT_DIR)
    ap.add_argument("--date", help="파일명 MMDD(기본 오늘)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    try:
        items = json.load(open(a.input, encoding="utf-8")) if a.input else from_replies(a.from_replies, a.status)
        s = build(items, a.out_dir, a.date, a.dry_run)
        passed = s.pop("_통과")
        if a.record and not a.dry_run:
            s["기록"] = record(passed)[1]
        print(json.dumps(s, ensure_ascii=False, indent=1))
    except KitError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
