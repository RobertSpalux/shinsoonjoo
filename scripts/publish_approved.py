#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
심의 승인 → 게시 자동화 (로버트 2026-09-30 10:59 「본사 심사완료된 거 확인해서 진행하는 것까지 자동화」).

    python scripts/publish_approved.py              # 드라이런 — 무엇을 할지만 보여 준다(쓰기 0)
    python scripts/publish_approved.py --live       # 실제로 한다
    옵션: --slug <slug>(한 글만)  --base-url http://localhost:3000(이미 뜬 서버)

사람이 하던 3단계를 그대로 옮긴다 — 「발행 → 어드민에서 정보 입력 → 팜스 ＋(게시위치)」
  ① 본진: 어드민 [발행] 과 **같은 서버 경로**(POST /api/admin/update)로 is_main_published=true.
     심의필 줄은 페이지가 ad_reviews(approved)에서 렌더한다(renderMandatoryNotice — §6.3 정본 형식).
     승인 원고 본문은 건드리지 않는다. needs_human_review 는 어드민 발행과 같이 함께 해제한다(발행 = 검수 기록).
  ② 라이브 확인: https://goodfinance.kr/news/<slug> 가 200 이고 **심의필 번호가 페이지에 보일 때까지** 기다린다.
  ③ 게시 URL 기록: POST /api/admin/ad-review action=record-posted-url (posted_url 만. url_registered_at 은 비움).
  ④ 팜스 ＋ 는 robert-os 감시기(pams_wheel 게시위치저장)가 「approved + posted_url + url_registered_at 없음」을 보고 한다.
  네이버: 심의 때 올린 **비공개 글이 승인본**이다 → 할 일은 「그 글 공개 전환 + 심의필 한 줄 확인」(로버트 09-30 11:25).
     Downloads\\PAMS접수\\_네이버게시\\MMDD_N호_네이버.txt(안내) + .html(서식 참고본, configs/naver-format.json 규격)
     + 사진 복사본(_이미지1~N) · 텔레그램 알림.
     공개되면 네이버 RSS(configs/naver-format.json blog.rss)를 제목으로 짝지어 posted_url 자동 기록(애매하면 텔레그램 질문 1회).
  배포 체크: approved + posted_url 인데 어드민 「배포」 체크가 꺼진 채널(naver·blogspot·instagram·threads)은
     어드민 체크박스와 같은 /api/admin/update 로 켠다.
  자동 실행: pams_auto 10분 바퀴(로버트 결정 2026-09-30 11:36 「머지다 했고, 본진자동공개 켜」).
  만료: approved 심의필이 30일 안에 끝나면 텔레그램 알림(§6.3 유효기간 관리 — 하루 1번).
  🔴 게시위치 지연: 승인 뒤 OVERDUE_HOURS 가 지나도 url_registered_at 이 비어 있으면 텔레그램(하루 1번).
     게시위치 미등록은 **신규·연장 심의 제한 사유**다(2025-11-13 의무화, CLAUDE.md §6.4). 등록은 robert-os 감시기가
     하는데, 감시기는 사람이 로그인한 창을 쥐고 있어야 돈다 — 창이 닫히면 조용히 멈춘다. 그래서 여기서 따로 센다.
     단계를 갈라 알린다: posted_url 없음(본진 게시 실패 · 네이버 공개 전환 대기) / posted_url 있음(감시기 등록 대기).
  심사 지연: submitted·under_review 가 STALE_HOURS 넘게 그대로면 하루 1번 알린다(실측 최장 47시간).
     승인 사실을 DB 로 옮기는 것도 감시기다 — 감시기가 멈추면 PAMS 에서 승인돼도 여기서는 계속 「심사중」으로 보인다.

🔴 게이트(하나라도 걸리면 그 글은 건너뛴다 — 고쳐서 진행하지 않는다):
  · review_no 가 없거나 형식 불일치, 오늘이 review_from~review_to 밖 → 게시 금지
  · 컴플라이언스 미통과(/preview 게이트 = 어드민과 같은 판정) → 게시 금지
  · 이미 게시된 채널은 게시 단계를 건너뛰고 URL 기록만 확인한다
"""
import argparse
import hashlib
import html as htmllib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pams_kit as kit
import review_lock  # noqa: E402

KST = timezone(timedelta(hours=9))
SITE = "https://goodfinance.kr"
NAVER_OUT = os.path.join(os.path.expanduser("~"), "Downloads", "PAMS접수", "_네이버게시")
STATE_PATH = os.path.join(kit.ROOT, "out", "publish_approved_state.json")
REVIEW_NO_RX = re.compile(r"^\d{4}-\d{2}-\d{1,5}$")
EXPIRY_DAYS = 30
OVERDUE_HOURS = 24
STALE_HOURS = 72
LIVE_WAIT_SEC = 240


def log(msg):
    print(f"[{datetime.now(KST):%H:%M:%S}] {msg}", flush=True)


# ── 순수 판정 (시험 대상) ─────────────────────────────────────
def review_ok(r, today):
    """게시해도 되는 심의필인가 — 번호 형식 + 오늘이 유효기간 안. (어드민·DB 트리거와 같은 조건)"""
    no = (r.get("review_no") or "").strip()
    if r.get("status") != "approved" or not REVIEW_NO_RX.match(no):
        return False, "심의필 번호 없음/형식 불일치"
    f, t = (r.get("review_from") or ""), (r.get("review_to") or "")
    if not f or not t:
        return False, "유효기간 비어 있음"
    if not (f <= today <= t):
        return False, f"유효기간 밖({f}~{t})"
    return True, ""


# 🔴 2026-10-02 8호 본진: PAMS 가 심의번호(0451)를 붙여 승인으로 보였던 건이 1시간 뒤 「반송」으로 바뀌었다.
#    비고는 「[GA명장]: 2026년 GA명장 증빙자료를 첨부하세요. 혹은 [22~25년 GA명장] 등의 표현으로 수정…」 —
#    조건이 붙은 승인이었는데 자동 공개 + 게시위치 등록까지 나갔다(반송 건에 심의필 표시 = 허위 심의필 위험).
#    그래서 비고가 표준 승인 문구가 아니면(= 조건) 자동 공개하지 않고 사람에게 넘긴다.
STANDARD_REMARK = "[본사승인] 심의받은 내용, 심의필번호 및 유효기간 그대로 게시"
REMARK_PREFIX = "PAMS 비고:"


def condition_remark(r):
    """승인 행의 조건 — notes 의 「PAMS 비고:」 줄 중 표준 승인 문구가 아닌 것, 또는 「조건부 승인」 표시. 없으면 None.
    (비고 줄은 robert-os 감시기가 적는다 — relay/pams_watch_condition_patch.md)"""
    notes = r.get("notes") or ""
    for ln in notes.splitlines():
        s = ln.strip()
        if s.startswith(REMARK_PREFIX):
            remark = s[len(REMARK_PREFIX):].strip()
            if remark and re.sub(r"\s+", "", remark) != re.sub(r"\s+", "", STANDARD_REMARK):
                return remark
    if "조건부 승인" in notes:
        return "조건부 승인"
    return None


def plan(rows, articles, today):
    """ad_reviews 행 → 할 일 목록. rows: approved 이고 posted_url 비어 있는 main/naver 행."""
    todo = []
    for r in rows:
        a = articles.get(r["article_id"])
        if not a or r.get("channel") not in ("main", "naver") or (r.get("posted_url") and not needs_republish(r, a)):
            continue
        ok, why = review_ok(r, today)
        cond = condition_remark(r) if ok else None
        if cond:
            ok, why = False, f"조건 붙은 승인 — 자동 공개 안 함(사람 확인): {cond}"
        todo.append({"row": r, "article": a, "channel": r["channel"], "ok": ok, "why": why, "cond": cond})
    return todo


def needs_republish(r, a):
    """게시 URL 은 남아 있는데 본진이 내려가 있는 승인 행 — 반송 → 보완 재승인 글(2026-10-02 8호).
    반송 때 비공개로 돌리고 게시위치 URL 은 지우지 않으므로(보완으로 덮는다) posted_url 만 보고 건너뛰면
    보완 승인 뒤 다시 공개되지 않는다."""
    return r.get("channel") == "main" and bool(r.get("posted_url")) and not a.get("is_main_published")


def rejected_live(rows, articles):
    """반송인데 본진이 공개돼 있는 글 → [(article, row)]. rows: 본진(main) ad_reviews 전부(created_at 포함).
    같은 글에 행이 여럿이면 **가장 최근 행**으로 본다(반송 뒤 재접수·승인된 글은 건드리지 않는다)."""
    latest = {}
    for r in rows:
        if r.get("channel") != "main":
            continue
        k = r["article_id"]
        if k not in latest or (r.get("created_at") or "") > (latest[k].get("created_at") or ""):
            latest[k] = r
    out = []
    for k, r in latest.items():
        a = articles.get(k)
        if a and r.get("status") == "rejected" and a.get("is_main_published"):
            out.append((a, r))
    return out


def expiring(rows, today, days=EXPIRY_DAYS):
    """approved 이고 review_to 가 오늘~days 안인 행."""
    lim = (date.fromisoformat(today) + timedelta(days=days)).isoformat()
    return [r for r in rows if r.get("status") == "approved" and r.get("review_to")
            and today <= r["review_to"] <= lim]


def overdue(rows, now, hours=OVERDUE_HOURS):
    """approved 인데 승인 뒤 hours 가 지나도 게시위치가 등록되지 않은 행 → [(row, 단계)].
    now: aware datetime. 승인 시각 = reviewed_at, 없으면 review_from(심의필일자) 0시 KST.
      ⚠️ robert-os 감시기가 승인으로 바꾼 행은 reviewed_at 이 비어 있다(실측 2026-10-01: 7987·7998) — 그래서 review_from 으로 받는다.
    둘 다 없거나 읽을 수 없는 행은 건너뛴다."""
    out = []
    for r in rows:
        if r.get("status") != "approved" or r.get("url_registered_at"):
            continue
        try:
            if r.get("reviewed_at"):
                at = datetime.fromisoformat(str(r["reviewed_at"]).replace("Z", "+00:00"))
                if at.tzinfo is None:
                    at = at.replace(tzinfo=timezone.utc)
            elif r.get("review_from"):
                at = datetime.fromisoformat(str(r["review_from"])[:10]).replace(tzinfo=KST)
            else:
                continue
        except ValueError:
            continue
        if now - at >= timedelta(hours=hours):
            out.append((r, "게시위치 등록 대기" if r.get("posted_url") else "게시 전"))
    return out


def stale_submitted(rows, now, hours=STALE_HOURS):
    """submitted·under_review 인데 접수(submitted_at) 뒤 hours 가 지난 행. submitted_at 없으면 건너뛴다."""
    out = []
    for r in rows:
        if r.get("status") not in ("submitted", "under_review") or not r.get("submitted_at"):
            continue
        try:
            at = datetime.fromisoformat(str(r["submitted_at"]).replace("Z", "+00:00"))
        except ValueError:
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        if now - at >= timedelta(hours=hours):
            out.append(r)
    return out


def fetch_main_rows(env):
    """본진 ad_reviews 전부 + 공개 중인 글 — rejected_live 판정용."""
    url, h = kit._rest(env)
    base = url.rsplit("/", 1)[0]
    r = requests.get(f"{base}/ad_reviews", headers=h, timeout=30, params={
        "select": "id,article_id,channel,status,created_at,rejected_reason", "channel": "eq.main"})
    r.raise_for_status()
    q = requests.get(url, headers=h, timeout=30, params={
        "select": "id,slug,title,is_main_published", "is_main_published": "eq.true"})
    q.raise_for_status()
    return r.json(), {a["id"]: a for a in q.json()}


def fetch_pending(env):
    url, h = kit._rest(env)
    r = requests.get(url.rsplit("/", 1)[0] + "/ad_reviews", headers=h, timeout=30, params={
        "select": "id,article_id,channel,status,submitted_at,posting_title,premium_articles(slug,title)",
        "status": "in.(submitted,under_review)", "channel": kit.NOT_KIN})
    r.raise_for_status()
    return r.json()


def overdue_msg(title, r, stage, hours):
    ch = {"main": "본진", "naver": "네이버", "threads": "스레드", "instagram": "인스타"}.get(r.get("channel"), r.get("channel"))
    why = ("감시기(robert-os pams_watch) 창이 로그인된 채 떠 있는지 확인 — 등록은 그 창이 한다"
           if stage == "게시위치 등록 대기" else
           ("네이버 비공개 글을 공개로 전환했는지 확인 — 공개되면 RSS 로 URL 을 회수한다" if r.get("channel") == "naver"
            else "게시가 안 됐다 — 텔레그램의 게시 실패 알림·pams_auto 로그 확인"))
    return (f"🔴 게시위치 미등록 {hours}시간+ — {title} {ch} 제{r.get('review_no')}호 · 단계: {stage}\n"
            f"미등록은 신규·연장 심의 제한 사유다. {why}")


def live_has_review(page_html, review_no):
    return bool(page_html) and review_no in page_html


# ── DB 읽기(쓰기는 전부 어드민 서버 경로) ─────────────────────────
def fetch_rows(env):
    url, h = kit._rest(env)
    base = url.rsplit("/", 1)[0]
    r = requests.get(f"{base}/ad_reviews", headers=h, timeout=30, params={
        "select": "id,article_id,channel,status,review_no,review_from,review_to,review_authority,posted_url,url_registered_at,notes,reviewed_at",
        "status": "eq.approved", "channel": kit.NOT_KIN})
    r.raise_for_status()
    rows = r.json()
    ids = sorted({x["article_id"] for x in rows})
    arts = {}
    if ids:
        q = requests.get(url, headers=h, timeout=30, params={
            "select": "id,slug,title,naver_title,is_main_published,is_naver_published,is_blogspot_published,"
                      "is_instagram_published,is_threads_published,needs_human_review",
            "id": "in.(" + ",".join(ids) + ")"})
        q.raise_for_status()
        arts = {a["id"]: a for a in q.json()}
    return rows, arts


# ── 어드민 서버 경로 ───────────────────────────────────────────
def admin_cookie(env):
    pw = env.get("ADMIN_PASSWORD")
    if not pw:
        raise kit.KitError("ADMIN_PASSWORD 가 .env.local 에 없습니다")
    return {"shin_admin": hashlib.sha256(f"shin-admin:{pw}".encode()).hexdigest()}


def admin_post(server, env, path, payload):
    r = requests.post(server.base + path, json=payload, cookies=admin_cookie(env), timeout=300)
    try:
        body = r.json()
    except ValueError:
        body = {"error": r.text[:200]}
    if r.status_code >= 300 or body.get("error"):
        raise kit.KitError(f"{path} {r.status_code} — {body.get('error')}")
    return body


def publish_msg(slug, url, r, title=None):
    """본진 자동 게시 텔레그램 1통 — 규격 고정(시험 test_publish_msg). 이 한 통으로 게시~게시위치 등록 흐름을 따라간다."""
    return "\n".join([
        f"✅ [본진 자동 게시] {kit.title_label(title, slug)}",
        f"① 발행: {url}",
        f"② 라이브 심의필 확인: {review_line(r)}",
        f"③ posted_url 기록: ad_reviews {r['id'][:8]} (main)",
        "④ 팜스 게시위치(＋): 감시기 다음 바퀴 — 완료 시 url_registered_at 이 채워지고 어드민 박스가 사라진다",
    ])


def wait_live(slug, review_no, wait=LIVE_WAIT_SEC):
    """라이브 페이지에 심의필 번호가 보일 때까지(ISR 갱신) 기다린다."""
    url = f"{SITE}/news/{slug}"
    deadline = time.time() + wait
    last = ""
    while time.time() < deadline:
        try:
            r = requests.get(url, timeout=30, headers={"Cache-Control": "no-cache"})
            last = f"HTTP {r.status_code}"
            if r.status_code == 200 and live_has_review(r.text, review_no):
                return url
        except requests.RequestException as e:
            last = str(e)[:80]
        time.sleep(15)
    raise kit.KitError(f"라이브 확인 실패({wait}초) — {url} · 마지막 {last} · 심의필 {review_no} 미노출")


def publish_main(server, env, item, live):
    a, r = item["article"], item["row"]
    if not a.get("is_main_published"):
        fields = {"is_main_published": True}
        if a.get("needs_human_review") is True:
            fields["needs_human_review"] = False  # 어드민 [발행] 과 같다 — 발행 = 검수 완료 기록
        if not live:
            return f"(드라이런) 발행 {a['slug']} fields={fields}"
        kit.gate(kit.preview_url(server, env, a["slug"]))  # 어드민과 같은 컴플라이언스 판정
        admin_post(server, env, "/api/admin/update", {"table": "premium_articles", "id": a["id"], "fields": fields})
        log(f"발행 {a['slug']}")
    elif not live:
        return f"(드라이런) 이미 발행됨 — URL 기록만 {a['slug']}"
    url = wait_live(a["slug"], r["review_no"])
    admin_post(server, env, "/api/admin/ad-review", {
        "action": "record-posted-url", "articleId": a["id"], "channel": "main", "reviewId": r["id"], "postedUrl": url})
    return publish_msg(a["slug"], url, r, a.get("title"))


def review_line(r):
    """§6.3 정본 형식 심의필 한 줄 — 페이지·조립 원고와 같은 꼴(renderMandatoryNotice)."""
    f = (r.get("review_from") or "").replace("-", ".")
    t = (r.get("review_to") or "").replace("-", ".")
    return f"{r.get('review_authority') or '프라임에셋'} 심의필 제{r['review_no']}호 ({f}~{t})"


def copy_images(slug, out_dir, base):
    """assets/naver/<slug>/ 사진 → 게시본 폴더에 순서 번호 파일명으로 복사. 복사한 파일명 목록."""
    src_dir = os.path.join(kit.ROOT, "assets", "naver", slug)
    names = sorted(n for n in os.listdir(src_dir) if n.lower().endswith((".png", ".jpg", ".jpeg"))) \
        if os.path.isdir(src_dir) else []
    out = []
    for i, n in enumerate(names, 1):
        dst = f"{base}_이미지{i}{os.path.splitext(n)[1].lower()}"
        shutil.copyfile(os.path.join(src_dir, n), os.path.join(out_dir, dst))
        out.append(dst)
    return out


def rich_html(text_path, images):
    """네이버 서식 HTML(configs/naver-format.json 규격) — 어드민 [게시용 복사]와 같은 toNaverRichHtml."""
    r = subprocess.run(["npx", "tsx", "scripts/naver_rich.mts", text_path, *images], cwd=kit.ROOT,
                       capture_output=True, text=True, encoding="utf-8", shell=(os.name == "nt"))
    if r.returncode != 0 or not r.stdout.strip():
        raise kit.KitError(f"네이버 서식 HTML 실패 — {r.stderr.strip()[:200]}")
    return r.stdout


def naver_kit(server, env, item, live, out_dir=NAVER_OUT, now=None):
    """네이버 승인 후 할 일 안내 — **새 게시가 아니라 심의 때 올려 둔 비공개 글을 공개로 전환**(로버트 09-30 11:25).

    비공개 글이 곧 승인본이다. 할 일: 그 글을 열어 심의필 한 줄을 확인·치환 → 전체공개.
    게시본(.txt/.html + 사진)은 **대조용 참고**다 — 비공개 글과 다르면 비공개 글이 정본이다(원안 변경 금지).
    """
    a, r = item["article"], item["row"]
    base = kit.kit_basename(a["slug"], "naver", now)
    txt = os.path.join(out_dir, base + ".txt")
    if not live:
        return f"(드라이런) 네이버 공개 전환 안내 → {txt}"
    body = admin_post(server, env, "/api/admin/compose", {"articleId": a["id"], "channel": "naver", "mode": "publish"})
    if r["review_no"] not in body["text"]:
        raise kit.KitError("게시용 원고에 심의필 번호가 없습니다 — 조립 결과 확인 필요")
    os.makedirs(out_dir, exist_ok=True)
    imgs = copy_images(a["slug"], out_dir, base)
    body_path = os.path.join(out_dir, base + "_본문.txt")
    open(body_path, "w", encoding="utf-8", newline="\n").write(body["text"])
    html = rich_html(body_path, imgs)
    open(txt[:-4] + ".html", "w", encoding="utf-8").write(
        f"<!doctype html><meta charset='utf-8'><title>{htmllib.escape(body['title'])}</title>"
        f"<body style='max-width:860px;margin:24px auto;padding:0 16px'>"
        f"<p style='font-size:24px;'><b>{htmllib.escape(body['title'])}</b></p>\n{html}</body>")
    head = [
        f"[네이버 승인 — 공개 전환] {kit.issue_label(a['slug'])} · {a['slug']}",
        "",
        "할 일(새로 올리지 않는다):",
        f"  1. 심의 때 비공개로 올려 둔 글을 연다 — 제목: {body['title']}",
        f"  2. 필수안내사항의 심의필 줄을 아래 한 줄로 확인·치환한다(자리표시·공란이면 이 줄로):",
        f"       {review_line(r)}",
        "  3. 그 밖의 글자·사진·서식은 한 글자도 고치지 않는다(비공개 글 = 승인본).",
        "  4. 공개 설정을 「전체공개」로 바꾼다.",
        "  5. 게시 URL 은 RSS 로 자동 회수된다(10분 주기) → 감시기가 팜스 게시위치(＋) 등록.",
        "",
        "서식 규격: configs/naver-format.json (소제목 24 · 목록 19 · 본문 15 · 필수안내 13 · 색 지정 금지)",
        f"대조용 참고본: {os.path.basename(txt[:-4] + '.html')} · 사진 {len(imgs)}장: " + (", ".join(imgs) or "없음"),
        "",
        "── 대조용 본문(조립본) ──",
    ]
    open(txt, "w", encoding="utf-8", newline="\n").write("\n".join(head) + "\n" + body["text"] + "\n")
    return f"네이버 공개 전환 안내 {txt} (+.html · 사진 {len(imgs)}장 복사)"


# ── 배포 체크 동기화 · 네이버 URL 회수 ─────────────────────────────
FLAG = {"naver": "is_naver_published", "blogspot": "is_blogspot_published", "instagram": "is_instagram_published",
        "threads": "is_threads_published"}


def plan_flags(rows, articles, today):
    """approved · 유효 · posted_url 있음 인데 어드민 배포 체크가 꺼진 채널 → [(article, row, flag)]."""
    out = []
    for r in rows:
        a = articles.get(r["article_id"])
        flag = FLAG.get(r.get("channel"))
        if a and flag and r.get("posted_url") and not a.get(flag) and review_ok(r, today)[0]:
            out.append((a, r, flag))
    return out


def norm_title(s):
    return re.sub(r"\s+", "", htmllib.unescape(s or ""))


def match_rss(items, rows, articles):
    """RSS [(title, link)] × naver 행(posted_url 없음) → ([(row, link)], [(row, 사유)]). 제목 완전 일치(공백 무시)만."""
    ok, ask = [], []
    for r in rows:
        a = articles.get(r["article_id"]) or {}
        want = norm_title(a.get("naver_title"))
        if not want:
            continue
        hits = [link for t, link in items if norm_title(t) == want]
        if len(hits) == 1:
            ok.append((r, hits[0]))
        elif len(hits) > 1:
            ask.append((r, f"같은 제목 글이 {len(hits)}개 — {', '.join(hits)}"))
    return ok, ask


def fetch_rss(url):
    import xml.etree.ElementTree as ET
    x = requests.get(url, timeout=30)
    x.raise_for_status()
    root = ET.fromstring(x.content)
    out = []
    for it in root.iter("item"):
        link = (it.findtext("link") or "").split("?")[0].strip()
        out.append(((it.findtext("title") or "").strip(), link))
    return out


# ── 상태·알림 ─────────────────────────────────────────────────
def load_state():
    try:
        return json.load(open(STATE_PATH, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(st):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    json.dump(st, open(STATE_PATH + ".part", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(STATE_PATH + ".part", STATE_PATH)


def run(env, notify, live=False, slug=None, base_url=None, today=None):
    today = today or datetime.now(KST).date().isoformat()
    rows, arts = fetch_rows(env)
    todo = [t for t in plan([r for r in rows if not r.get("posted_url")
                             or needs_republish(r, arts.get(r["article_id"], {}))], arts, today)
            if not slug or t["article"]["slug"] == slug]
    st = load_state() if live else {}
    out = []

    exp = expiring(rows, today)
    for r in exp:
        key = f"exp:{r['id']}:{today}"
        a = arts.get(r["article_id"], {})
        msg = (f"⏳ 심의필 만료 임박 — {kit.title_label(a.get('title'), a.get('slug') or '')} {r['channel']} "
               f"제{r['review_no']}호 ~{r['review_to']} (연장 신청: 바이럴 만료+90일 이내)")
        out.append(msg)
        if live and key not in st:
            notify(msg)
            st[key] = True

    for r, stage in overdue(rows, datetime.now(KST)):
        a = arts.get(r["article_id"], {})
        if slug and a.get("slug") != slug:
            continue
        msg = overdue_msg(kit.title_label(a.get("title"), a.get("slug") or ""), r, stage, OVERDUE_HOURS)
        out.append(msg.split("\n")[0])
        key = f"overdue:{r['id']}:{today}"
        if live and key not in st:
            notify(msg)
            st[key] = True

    try:
        pending = fetch_pending(env)
    except requests.RequestException as e:
        pending = []
        out.append(f"⚠️ 심사중 행 읽기 실패 — {e}")
    for r in stale_submitted(pending, datetime.now(KST)):
        a = r.get("premium_articles") or {}
        if slug and a.get("slug") != slug:
            continue
        msg = (f"⏱ 심사 {STALE_HOURS}시간+ — {kit.title_label(a.get('title'), a.get('slug') or '')} {r.get('channel')} "
               f"(접수 {str(r.get('submitted_at'))[:16]})\n팜스 목록에서 실제 상태를 확인하세요. 이미 승인됐다면 감시기(pams_watch) 창이 멈춘 것이다.")
        out.append(msg.split("\n")[0])
        key = f"stale:{r['id']}:{today}"
        if live and key not in st:
            notify(msg)
            st[key] = True

    # 네이버 URL 회수(RSS) — 공개 전환된 승인 글을 제목으로 짝지어 posted_url 로
    naver_wait = [r for r in rows if r.get("channel") == "naver" and not r.get("posted_url")
                  and (not slug or arts.get(r["article_id"], {}).get("slug") == slug)]
    rss_ok, rss_ask = [], []
    if naver_wait:
        try:
            fmt = json.load(open(os.path.join(kit.ROOT, "configs", "naver-format.json"), encoding="utf-8"))
            rss_ok, rss_ask = match_rss(fetch_rss(fmt["blog"]["rss"]), naver_wait, arts)
        except (requests.RequestException, ValueError, KeyError) as e:
            out.append(f"⚠️ 네이버 RSS 읽기 실패 — {e}")
    for r, why in rss_ask:
        key = f"ask:{r['id']}"
        out.append(f"❓ 네이버 URL 짝 애매 — {arts[r['article_id']]['slug']} · {why}")
        if live and key not in st:
            _a = arts[r['article_id']]
            notify(f"❓ 네이버 게시 URL 을 못 정했습니다 — {kit.title_label(_a.get('title'), _a['slug'])}\n{why}\n맞는 URL 을 ad_reviews(naver).posted_url 에 넣어 주세요.")
            st[key] = True
    # 조건 붙은 승인 — 자동 공개하지 않고 한 번 알린다
    for t in todo:
        if t.get("cond"):
            a = t["article"]
            key = f"cond:{t['row']['id']}"
            msg = (f"🟡 조건 붙은 승인 — 자동 공개 안 함 · {kit.title_label(a.get('title'), a['slug'])} {t['channel']} "
                   f"제{t['row'].get('review_no')}호\n비고: {t['cond']}\n조건을 해소(보완·증빙)한 뒤 사람이 공개한다. 반송으로 바뀌면 그대로 둔다.")
            out.append(msg.split("\n")[0])
            if live and key not in st:
                notify(msg)
                st[key] = datetime.now(KST).isoformat()

    # 반송인데 본진이 공개돼 있다 → 즉시 비공개(심의필 줄이 남아 있으면 허위 심의필이 된다)
    try:
        main_rows, live_arts = fetch_main_rows(env)
        down = [x for x in rejected_live(main_rows, live_arts) if not slug or x[0]["slug"] == slug]
    except requests.RequestException as e:
        down = []
        out.append(f"⚠️ 반송·공개 대조 읽기 실패 — {e}")

    flags = [f for f in plan_flags(rows, arts, today) if not slug or f[0]["slug"] == slug]
    # RSS 로 방금 URL 을 얻는 채널도 배포 체크 대상
    for r, link in rss_ok:
        a = arts[r["article_id"]]
        if not a.get(FLAG["naver"]) and review_ok(r, today)[0]:
            flags.append((a, {**r, "posted_url": link}, FLAG["naver"]))

    if todo or rss_ok or flags or down:
        server = kit.LocalServer(base_url=base_url, log=log) if live else None
        if server:
            server.__enter__()
        try:
            for a, r in down:
                title = kit.title_label(a.get("title"), a["slug"])
                if not live:
                    out.append(f"(드라이런) 반송 → 본진 비공개 {a['slug']}")
                    continue
                try:
                    admin_post(server, env, "/api/admin/update",
                               {"table": "premium_articles", "id": a["id"], "fields": {"is_main_published": False}})
                    out.append(f"✅ 반송 → 본진 비공개 {a['slug']}")
                    notify(f"🔴 반송 감지 → 본진 비공개 처리 — {title}\n사유: {r.get('rejected_reason') or '(감시기 기록 확인)'}\n"
                           f"게시위치 URL 은 지우지 않는다 — 보완 재접수로 덮는다. 라이브 페이지가 내려갔는지 확인하세요(ISR 갱신 최대 5분).")
                except kit.KitError as e:
                    out.append(f"❌ 반송 비공개 실패 {a['slug']} — {e}")
                    notify(f"❌ 반송 비공개 실패 — {title} — {e}\n어드민에서 본진 발행을 끄세요.")
            for t in todo:
                a = t["article"]
                if not t["ok"]:
                    out.append(f"⛔ 건너뜀 {a['slug']} {t['channel']} — {t['why']}")
                    continue
                # 🔴 심의본 = 게시본 대조(review_lock) — 접수 뒤 원고가 바뀌었으면 게시하지 않는다.
                #    이미 공개된 본진(URL 기록만 남은 경우)은 대조할 게시가 남아 있지 않으므로 건너뛴다.
                already = t["channel"] == "main" and a.get("is_main_published")
                if not already:
                    try:
                        lk, noted, cur = review_lock.check(env, a["slug"], t["channel"], t["row"].get("notes"))
                    except (kit.KitError, requests.RequestException) as e:
                        lk, noted, cur = "missing", None, ""
                        log(f"원고 대조 실패 {a['slug']} — {e}")
                    if review_lock.blocks(lk, t["channel"]):
                        msg = review_lock.message(kit.title_label(a.get("title"), a["slug"]), t["channel"], lk, noted, cur)
                        out.append(msg.split("\n")[0])
                        lkey = f"lock:{t['row']['id']}:{lk}:{(cur or '')[:12]}"
                        if live and lkey not in st:
                            notify(msg)
                            st[lkey] = datetime.now(KST).isoformat()
                        continue
                    if lk == "missing":   # 네이버 — 사람이 공개 전환한다. 막지 않고 경고만 남긴다
                        out.append(f"⚠️ {a['slug']} naver — 심의본 원고해시 기록 없음(대조 못 함)")
                try:
                    if t["channel"] == "main":
                        res = publish_main(server, env, t, live)
                    else:
                        key = f"naver:{t['row']['id']}"
                        if live and key in st:
                            continue  # 이미 게시본을 만들었다 — robert-os 게시 대기
                        res = naver_kit(server, env, t, live)
                        if live:
                            st[key] = datetime.now(KST).isoformat()
                            notify(f"📝 네이버 게시 대기 — {kit.title_label(a.get('title'), a['slug'])} 제{t['row']['review_no']}호\n{res}")
                    out.append(("✅ " if live else "") + res)
                    if live and t["channel"] == "main":
                        notify(res)
                except kit.KitError as e:
                    out.append(f"❌ {a['slug']} {t['channel']} — {e}")
                    if live:
                        notify(f"❌ 승인→게시 실패 — {kit.title_label(a.get('title'), a['slug'])} {t['channel']} — {e}")
            for r, link in rss_ok:
                a = arts[r["article_id"]]
                if not live:
                    out.append(f"(드라이런) 네이버 URL 회수 {a['slug']} ← {link}")
                    continue
                try:
                    admin_post(server, env, "/api/admin/ad-review", {
                        "action": "record-posted-url", "articleId": a["id"], "channel": "naver",
                        "reviewId": r["id"], "postedUrl": link})
                    out.append(f"✅ 네이버 URL 회수 {a['slug']} ← {link}")
                    notify(f"✅ 네이버 게시 URL 회수 — {kit.title_label(a.get('title'), a['slug'])}\n{link}\n→ 감시기 다음 바퀴에 팜스 게시위치(＋) 등록")
                except kit.KitError as e:
                    out.append(f"❌ 네이버 URL 기록 실패 {a['slug']} — {e}")
            for a, r, flag in flags:
                if not live:
                    out.append(f"(드라이런) 배포 체크 ON {a['slug']} {flag} (게시 URL {r['posted_url']})")
                    continue
                try:
                    # 어드민 배포 체크박스와 같은 경로 — 서버가 유효 심의필을 다시 확인한다
                    admin_post(server, env, "/api/admin/update",
                               {"table": "premium_articles", "id": a["id"], "fields": {flag: True}})
                    a[flag] = True
                    out.append(f"✅ 배포 체크 ON {a['slug']} {flag}")
                except kit.KitError as e:
                    out.append(f"❌ 배포 체크 실패 {a['slug']} {flag} — {e}")
        finally:
            if server:
                server.__exit__(None, None, None)
    if live:
        save_state(st)
    return out


def main():
    ap = argparse.ArgumentParser(description="심의 승인 → 게시 자동화")
    ap.add_argument("--live", action="store_true", help="실제로 쓴다(없으면 드라이런)")
    ap.add_argument("--slug")
    ap.add_argument("--base-url")
    a = ap.parse_args()
    env = kit.load_env()
    import pams_auto
    for line in run(env, notify=lambda t: pams_auto.telegram(env, t), live=a.live, slug=a.slug, base_url=a.base_url) or ["할 일 없음"]:
        print(line)


if __name__ == "__main__":
    main()
