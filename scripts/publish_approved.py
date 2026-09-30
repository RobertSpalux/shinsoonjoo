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
  네이버: 게시용 원고(어드민 [게시용 복사] 와 같은 /api/admin/compose mode=publish)를
     Downloads\\PAMS접수\\_네이버게시\\MMDD_N호_네이버.txt/.html 로 쓰고 텔레그램 알림. 실제 게시·posted_url 은 robert-os 가 붙인다.
  만료: approved 심의필이 30일 안에 끝나면 텔레그램 알림(§6.3 유효기간 관리 — 하루 1번).

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
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pams_kit as kit  # noqa: E402

KST = timezone(timedelta(hours=9))
SITE = "https://goodfinance.kr"
NAVER_OUT = os.path.join(os.path.expanduser("~"), "Downloads", "PAMS접수", "_네이버게시")
STATE_PATH = os.path.join(kit.ROOT, "out", "publish_approved_state.json")
REVIEW_NO_RX = re.compile(r"^\d{4}-\d{2}-\d{1,5}$")
EXPIRY_DAYS = 30
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


def plan(rows, articles, today):
    """ad_reviews 행 → 할 일 목록. rows: approved 이고 posted_url 비어 있는 main/naver 행."""
    todo = []
    for r in rows:
        a = articles.get(r["article_id"])
        if not a or r.get("channel") not in ("main", "naver") or r.get("posted_url"):
            continue
        ok, why = review_ok(r, today)
        todo.append({"row": r, "article": a, "channel": r["channel"], "ok": ok, "why": why})
    return todo


def expiring(rows, today, days=EXPIRY_DAYS):
    """approved 이고 review_to 가 오늘~days 안인 행."""
    lim = (date.fromisoformat(today) + timedelta(days=days)).isoformat()
    return [r for r in rows if r.get("status") == "approved" and r.get("review_to")
            and today <= r["review_to"] <= lim]


def live_has_review(page_html, review_no):
    return bool(page_html) and review_no in page_html


# ── DB 읽기(쓰기는 전부 어드민 서버 경로) ─────────────────────────
def fetch_rows(env):
    url, h = kit._rest(env)
    base = url.rsplit("/", 1)[0]
    r = requests.get(f"{base}/ad_reviews", headers=h, timeout=30, params={
        "select": "id,article_id,channel,status,review_no,review_from,review_to,review_authority,posted_url,url_registered_at",
        "status": "eq.approved"})
    r.raise_for_status()
    rows = r.json()
    ids = sorted({x["article_id"] for x in rows})
    arts = {}
    if ids:
        q = requests.get(url, headers=h, timeout=30, params={
            "select": "id,slug,title,naver_title,is_main_published,is_naver_published,needs_human_review",
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
    return f"본진 게시 {url} · 심의필 제{r['review_no']}호 확인 · posted_url 기록"


def naver_kit(server, env, item, live, out_dir=NAVER_OUT, now=None):
    a, r = item["article"], item["row"]
    base = kit.kit_basename(a["slug"], "naver", now)
    txt = os.path.join(out_dir, base + ".txt")
    if not live:
        return f"(드라이런) 네이버 게시본 → {txt}"
    body = admin_post(server, env, "/api/admin/compose", {"articleId": a["id"], "channel": "naver", "mode": "publish"})
    if r["review_no"] not in body["text"]:
        raise kit.KitError("게시용 원고에 심의필 번호가 없습니다 — 조립 결과 확인 필요")
    img_dir = os.path.join(kit.ROOT, "assets", "naver", a["slug"])
    imgs = sorted(os.listdir(img_dir)) if os.path.isdir(img_dir) else []
    os.makedirs(out_dir, exist_ok=True)
    head = [f"제목: {body['title']}", f"심의필: 프라임에셋 심의필 제{r['review_no']}호 ({r['review_from']} ~ {r['review_to']})",
            "이미지(순서): " + (", ".join(os.path.join(img_dir, i) for i in imgs) or "없음"),
            "🔴 승인본 그대로 붙인다 — 한 글자도 고치지 않는다. 게시 후 URL 을 ad_reviews(naver).posted_url 에.", "", "── 본문 ──"]
    open(txt, "w", encoding="utf-8", newline="\n").write("\n".join(head) + "\n" + body["text"] + "\n")
    paras = "".join(f"<p>{htmllib.escape(p) or '&nbsp;'}</p>\n" for p in body["text"].split("\n"))
    open(txt[:-4] + ".html", "w", encoding="utf-8").write(
        f"<!doctype html><meta charset='utf-8'><title>{htmllib.escape(body['title'])}</title>\n<h1>{htmllib.escape(body['title'])}</h1>\n{paras}")
    return f"네이버 게시본 {txt} (+.html · 이미지 {len(imgs)}장)"


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
    todo = [t for t in plan([r for r in rows if not r.get("posted_url")], arts, today)
            if not slug or t["article"]["slug"] == slug]
    st = load_state() if live else {}
    out = []

    exp = expiring(rows, today)
    for r in exp:
        key = f"exp:{r['id']}:{today}"
        a = arts.get(r["article_id"], {})
        msg = f"⏳ 심의필 만료 임박 — {a.get('slug')} {r['channel']} 제{r['review_no']}호 ~{r['review_to']} (연장 신청: 바이럴 만료+90일 이내)"
        out.append(msg)
        if live and key not in st:
            notify(msg)
            st[key] = True

    if todo:
        server = kit.LocalServer(base_url=base_url, log=log) if live else None
        if server:
            server.__enter__()
        try:
            for t in todo:
                a = t["article"]
                if not t["ok"]:
                    out.append(f"⛔ 건너뜀 {a['slug']} {t['channel']} — {t['why']}")
                    continue
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
                            notify(f"📝 네이버 게시 대기 — {a['slug']} 제{t['row']['review_no']}호\n{res}")
                    out.append(("✅ " if live else "") + res)
                    if live and t["channel"] == "main":
                        notify(f"✅ {res}\n→ 감시기 다음 바퀴에 팜스 게시위치(＋) 등록")
                except kit.KitError as e:
                    out.append(f"❌ {a['slug']} {t['channel']} — {e}")
                    if live:
                        notify(f"❌ 승인→게시 실패 {a['slug']} {t['channel']} — {e}")
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
