#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
스레드 답글 댓글심의 접수 정리표 — 로버트가 PAMS 댓글심의 폼에 한 건씩 옮겨 넣는다.

    python scripts/pams_reply_kit.py --input <답글.json>
    python scripts/pams_reply_kit.py --from-replies D:\\robert-os\\finance\\state\\replies.json [--status 승인]
    옵션: --out-dir <폴더>  --date MMDD  --dry-run(파일 안 쓰고 요약만)

입력(--input): [{"post_url": 원글 URL, "comment": 댓글 원문, "reply": 답글 원고, "comment_url": 댓글 링크(선택)}]
입력(--from-replies): robert-os reply_bot 기록. 계정=goodfinance · 초안 있음 · 상태=--status 인 것만.

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
           "글자수", "카테고리(PAMS 선택)", "특이사항(100바이트 이내)", "심의필번호(승인 후)", "유효기간(승인 후)", "게시 URL(게시 후)"]


class KitError(Exception):
    pass


def mask_phone(text):
    return PHONE_RX.sub(lambda m: m.group(0)[:3] + "-****-****", text or "")


def from_replies(path, status):
    d = json.load(open(path, encoding="utf-8"))
    out = []
    for cid, c in (d.get("댓글") or {}).items():
        if c.get("계정") != "goodfinance" or not c.get("초안") or c.get("상태") != status:
            continue
        short = c.get("뿌리글_짧은")
        out.append({"post_url": f"{PROFILE}/post/{short}" if short else PROFILE, "comment": c.get("글") or "",
                    "reply": c["초안"], "comment_url": c.get("링크") or "", "id": cid})
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
               "막힘사유": [{"reply": it["reply"], "사유": why} for it, why in blocked]}
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
                   it["reply"], len(it["reply"]), "", "", "", "", ""])
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


def main():
    ap = argparse.ArgumentParser(description="스레드 답글 댓글심의 접수 정리표")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", help="답글 목록 JSON")
    src.add_argument("--from-replies", help="robert-os finance/state/replies.json")
    ap.add_argument("--status", default="승인", help="--from-replies 에서 고를 상태(기본 승인)")
    ap.add_argument("--out-dir", default=OUT_DIR)
    ap.add_argument("--date", help="파일명 MMDD(기본 오늘)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    try:
        items = json.load(open(a.input, encoding="utf-8")) if a.input else from_replies(a.from_replies, a.status)
        print(json.dumps(build(items, a.out_dir, a.date, a.dry_run), ensure_ascii=False, indent=1))
    except KitError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
