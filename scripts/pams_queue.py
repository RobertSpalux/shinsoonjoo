#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 순서(운영표) — 칸이 비면 로버트에게 「다음 접수: ○」 한 줄.

    python scripts/pams_queue.py          # 운영표 한 줄 + 지금 다음 접수(알림 안 보냄)

순서 = configs/pams_queue.json(단일 출처). pams_auto 가 매 바퀴 notify_next() 를 부른다.
  · 심사중 = ad_reviews.status ∈ {submitted, under_review} 전체 건수(팜스 한도 = [심사중] 3건, CLAUDE.md §6.4).
  · 끝난 항목 = 그 글·채널에 submitted/under_review/approved 행이 있음 → 건너뜀.
  · 다음 접수 = 끝나지 않았고 키트(zip)가 준비된 항목 중 칸 배정 규칙(pick_slot, PAIR1 2026-10-29)으로 고른 하나 —
    심사중 본진 0건이면 본진, 네이버 0건이면 네이버, 그 밖(남은 1칸)은 키트가 가장 오래 기다린 항목.
    키트 없는 항목(네이버 캡처 전 등)은 건너뛰고 한 줄 끝에 적는다.
  · 🔴 한 쌍 원칙(PAIR1) — 네이버 키트가 같은 글 본진 승인보다 먼저 만들어졌으면(📄 본진 링크 없음) 후보에서 뺀다.
    본진이 승인·게시(posted_url)되면 send_naver_guides 가 네이버 비공개 파일을 다시 조립해 보낸다.
  · 네이버 = 같은 글 본진이 **승인된 뒤**에만 다음 접수가 된다(본진 먼저 원칙). 예외는 운영표 항목의 before_main_ok: true,
    그리고 네이버 단독 글(본진판 비어 있음 = kit.naver_only, SH16) — 운영표에 손으로 적지 않아도 자동 예외(SH17).
  · 알림 = 빈 칸이 있고 (다음 항목, 빈 칸 수)가 지난번과 다를 때만 1통. 같은 상태로 10분마다 보내지 않는다.
  · 칸이 다 찬 동안 pams_auto 는 키트 「준비됨」·「실패」 알림을 보류한다(state["held_kits"]). 칸이 비는 순간
    이 한 통 아래에 키트 파일 위치 / 「키트 없음 — 사유」 줄을 붙여 보내고 보류 목록을 비운다(SK2).
  · 칸이 비었는데 다음 접수할 키트가 없으면 「칸 N 빔 · 다음 할 일: 네이버 비공개 게시 → 캡처 · 파일: <txt>」
    하루 1통(SUP2). 파일 = _네이버비공개 중 ad_reviews 네이버 접수·승인 전인 가장 오래된 것(본진 승인 글 먼저).
"""
import glob
from datetime import datetime
import json
import os
import re
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402

QUEUE_JSON = os.path.join(kit.ROOT, "configs", "pams_queue.json")
ACTIVE = ("submitted", "under_review")
DONE = ACTIVE + ("approved",)


def load_queue(path=QUEUE_JSON):
    q = json.load(open(path, encoding="utf-8"))
    return int(q.get("limit", 3)), q["order"]


def label(item, titles=None):
    """알림용 표기 — 글 제목 (N호) 채널. titles 가 없으면 호수만(운영표 한 줄처럼 짧게 볼 때)."""
    t = (titles or {}).get(item["slug"])
    who = kit.title_label(t, item["slug"]) if t else kit.issue_label(item["slug"])
    return f"{who} {kit.CH_LABEL[item['channel']]}"


def find_kit(item, kit_dir=kit.KIT_DIR):
    """가장 최근 키트 zip(MMDD_N호_채널.zip). 없으면 None."""
    pat = os.path.join(kit_dir, f"*_{kit.issue_label(item['slug'])}_{kit.CH_LABEL[item['channel']]}.zip")
    hits = sorted(glob.glob(pat), key=os.path.getmtime)
    return hits[-1] if hits else None


# ── 순수 판정(시험 대상) ─────────────────────────────────────
def pick_slot(candidates, reviews, waited=None):
    """빈 칸 하나에 무엇을 넣나 — 로버트 2026-10-29 「본진 1 · 네이버 1 · 남은 1칸은 더 오래 기다린 쪽」(PAIR1).
    candidates: 키트가 준비된 항목(운영표 순서). waited: {(slug, channel): 키트 생성 시각(epoch)}.
    ① 심사중 본진이 0건이면 첫 본진 ② 심사중 네이버가 0건이면 첫 네이버 ③ 그 밖은 키트가 가장 오래 기다린 항목
    (시각을 모르면 운영표 순서). 스레드는 ③ 에서만 겨룬다."""
    if not candidates:
        return None
    busy = {ch: sum(1 for r in reviews if r.get("status") in ACTIVE and r.get("channel") == ch) for ch in ("main", "naver")}
    for ch in ("main", "naver"):
        if busy[ch] == 0:
            first = next((c for c in candidates if c["channel"] == ch), None)
            if first:
                return first
    waited = waited or {}
    inf = float("inf")
    return min(enumerate(candidates), key=lambda ic: (waited.get((ic[1]["slug"], ic[1]["channel"]), inf), ic[0]))[1]


def drop_prelink_naver_kits(order, reviews, kits, kit_time, naver_only=()):
    """본진 승인 **전에** 만든 네이버 키트는 본진 링크 줄(📄)이 없는 원고다 → 접수 후보에서 뺀다(PAIR1).
    네이버 승인본은 고칠 수 없어 링크가 먼저 있어야 한다. 네이버 단독·before_main_ok 항목은 그대로.
    reviews 의 본진 approved 행 reviewed_at(epoch) 보다 키트 시각이 이르면 None. → 새 kits(원본은 안 바꿈)."""
    main_at = {r["slug"]: r.get("reviewed_at") for r in reviews if r.get("channel") == "main" and r.get("status") == "approved"}
    out = dict(kits)
    for it in order:
        k = (it["slug"], it["channel"])
        if it["channel"] != "naver" or it.get("before_main_ok") or it["slug"] in naver_only or not out.get(k):
            continue
        at, t = main_at.get(it["slug"]), kit_time.get(k)
        if at is not None and t is not None and t < at:
            out[k] = None
    return out


def plan(order, reviews, kits, limit=3, naver_only=(), waited=None):
    """order: [{slug, channel}] · reviews: [{slug, channel, status}] · kits: {(slug, channel): zip경로|None}
    naver_only: 네이버 단독 글 slug 들(본진판 없음, SH16) — 기다릴 본진이 없으니 before_main_ok 와 같이 본다.
    waited: {(slug, channel): 키트 시각} — 남은 1칸 배정(pick_slot)에 쓴다.
    → {active, free, next(item|None), zip, waiting([item] 키트 없음), done([item])}"""
    active = sum(1 for r in reviews if r.get("status") in ACTIVE)
    done_keys = {(r["slug"], r["channel"]) for r in reviews if r.get("status") in DONE}
    approved = {(r["slug"], r["channel"]) for r in reviews if r.get("status") == "approved"}
    done, waiting, held, ready = [], [], [], []
    for it in order:
        k = (it["slug"], it["channel"])
        if k in done_keys:
            done.append(it)
            continue
        # 🔴 네이버는 같은 글 본진이 승인된 뒤에만(2026-10-01 로버트 원칙) — 예외는 운영표에 before_main_ok,
        #    그리고 네이버 단독 글(본진판 없음, SH17) — 본진이 영원히 없으니 손으로 적지 않아도 예외다.
        if (it["channel"] == "naver" and not it.get("before_main_ok") and it["slug"] not in naver_only
                and (it["slug"], "main") not in approved):
            held.append(it)
            continue
        if not kits.get(k):
            waiting.append(it)
            continue
        ready.append(it)
    nxt = pick_slot(ready, reviews, waited)
    zp = kits[(nxt["slug"], nxt["channel"])] if nxt else None
    return {"active": active, "free": max(0, limit - active), "next": nxt, "zip": zp,
            "waiting": waiting, "held": held, "done": done, "limit": limit}


def message(p, titles=None):
    """한 줄. 다음 항목이 없으면 None. 글 제목이 앞, 호수는 괄호."""
    if not p["next"] or p["free"] <= 0:
        return None
    tail = ""
    if p["waiting"]:
        tail = " · 키트 대기: " + ", ".join(label(w, titles) for w in p["waiting"])
    return f"다음 접수: {label(p['next'], titles)} — {os.path.basename(p['zip'])} (빈 칸 {p['free']}/{p['limit']}){tail}"


def should_notify(p, state):
    """빈 칸이 있고 (다음 항목, 빈 칸 수)가 지난번과 다를 때만.
    칸이 다 찼을 때 알림을 보류한 키트(state["held_kits"])가 있으면 빈 칸이 생긴 순간 보낸다(SK2)."""
    if p["free"] <= 0:
        return False, None
    if not p["next"]:
        return bool(state.get("held_kits")), None
    sig = f"{p['next']['slug']}|{p['next']['channel']}|{p['free']}"
    return sig != state.get("queue_notified") or bool(state.get("held_kits")), sig


def held_lines(held, file_exists=os.path.exists):
    """칸이 다 찼을 때 보류한 키트 알림 → 줄 목록. 만든 키트는 파일 위치, 못 만든 키트는 「키트 없음 — 사유」 한 줄."""
    out = []
    for k in sorted(held):
        h = held[k]
        if h.get("zip") and file_exists(h["zip"]):
            out.append(f"준비된 키트: {h['label']} — {h['zip']}")
        elif h.get("zip"):
            out.append(f"키트 없음 — {h['label']}: 만들었던 키트 파일이 없어졌습니다")
        else:
            out.append(f"키트 없음 — {h['label']}: {h.get('why') or '사유 미상'}")
    return out


def held_message(p, state, titles=None, file_exists=os.path.exists):
    """빈 칸이 생긴 순간의 한 통 — 「다음 접수」 한 줄 + 보류했던 키트 줄."""
    head = message(p, titles) or f"다음 접수: 운영표에 준비된 항목 없음 (빈 칸 {p['free']}/{p['limit']})"
    lines = held_lines(state.get("held_kits") or {}, file_exists)
    return "\n".join([head] + lines)


# ── 칸 빔 · 접수할 키트 없음 → 다음 할 일 한 통(SUP2) ─────────────
# 2026-10-23 연금 본진 승인 뒤 칸 1이 비었는데 이틀간 아무 말이 없었다 — 「다음 접수」는 키트가 있을 때만 나간다.
#   키트 이전 단계(네이버 비공개 게시·캡처 전)에서 멈추면 조용했다. 그 단계의 가장 오래된 파일을 하루 1통 알린다.
#   판정은 운영표가 아니라 _네이버비공개 폴더 × ad_reviews(네이버) — 10/20 공급분은 운영표에 없었다.
NAVER_PRIVATE_DIR = os.path.join(kit.KIT_DIR, "_네이버비공개")
PRIVATE_TXT = re.compile(r"^\d{4}_(.+)_네이버비공개\.txt$")


def label_to_slug(label, issues):
    """파일명 가운데 칸(N호 또는 slug) → slug. issues = {slug: N}(configs/issue_numbers.json)."""
    m = re.fullmatch(r"(\d+)호", label)
    if not m:
        return label
    n = int(m.group(1))
    return next((s for s, v in issues.items() if v == n), None)


def main_live(reviews):
    """본진이 승인되고 게시 URL(posted_url)까지 생긴 글 → {slug: 본진 승인 시각(epoch|None)}.
    네이버 비공개 게시·접수는 여기 든 글만(PAIR1 — 네이버 끝 📄 본진 링크가 살아 있어야 한다)."""
    return {r["slug"]: r.get("reviewed_at") for r in reviews
            if r.get("channel") == "main" and r.get("status") == "approved" and r.get("posted_url")}


def private_backlog(files, issues, reviews, has_kit=lambda label: False, naver_only=()):
    """순수: 네이버 비공개 파일 중 아직 네이버 접수·승인 전인 것, 오래된 순.
    files: [(이름, 경로, mtime)] · reviews: plan 과 같은 [{slug, channel, status, posted_url, reviewed_at}].
    🔴 한 쌍 원칙(PAIR1, 2026-10-29) — 같은 글 본진이 승인·게시(posted_url)되기 전의 파일은 내놓지 않는다.
       본진 승인 전에 만든 파일(mtime < 본진 승인)도 뺀다 — 📄 본진 링크 줄이 없는 조립본이다(재조립은 send_naver_guides).
       글마다 가장 최근 파일 하나만 본다. 네이버 단독 글(naver_only)은 기다릴 본진이 없어 종전대로.
    키트(zip)가 이미 있는 파일은 뺀다 — 그건 「다음 접수」 몫이다. → [{slug, label, path, main_ok}]"""
    done = {r["slug"] for r in reviews if r.get("channel") == "naver" and r.get("status") in DONE}
    live = main_live(reviews)
    newest = {}
    for name, path, mtime in sorted(files, key=lambda f: f[2]):
        m = PRIVATE_TXT.match(name)
        if not m:
            continue
        label = m.group(1)
        slug = label_to_slug(label, issues)
        if not slug or slug in done or has_kit(label):
            continue
        if slug not in naver_only:
            if slug not in live:
                continue
            at = live[slug]
            if at is not None and mtime < at:
                continue
        newest[slug] = (mtime, {"slug": slug, "label": label, "path": path, "main_ok": slug in live})
    return [v for _, v in sorted(newest.values(), key=lambda mv: mv[0])]


def slot_nudge_message(p, backlog):
    """칸이 비었는데 접수할 키트가 없을 때의 한 줄. 알릴 게 아니면 None."""
    if p["free"] <= 0 or p["next"]:
        return None
    if not backlog:
        return (f"칸 {p['free']} 빔 · 다음 할 일: 없음 — 접수할 키트도 네이버 비공개 대기 파일도 없습니다"
                " (원고 공급 SHIN_draft_daily 확인)")
    return f"칸 {p['free']} 빔 · 다음 할 일: 네이버 비공개 게시 → 캡처 · 파일: {backlog[0]['path']}"


def should_nudge(state, today):
    """하루 1통 — 같은 날 다시 보내지 않는다(10분 바퀴마다 되풀이 금지)."""
    return state.get("slot_nudge_day") != today


def list_private_files(folder=NAVER_PRIVATE_DIR):
    try:
        names = os.listdir(folder)
    except FileNotFoundError:
        return []
    return [(n, os.path.join(folder, n), os.path.getmtime(os.path.join(folder, n)))
            for n in names if PRIVATE_TXT.match(n) and os.path.isfile(os.path.join(folder, n))]


def notify_slot_empty(env, state, notify, log=print, today=None, kit_dir=kit.KIT_DIR):
    """pams_auto 한 바퀴에서 notify_next 뒤에 부른다. 보냈으면 그 한 줄을 돌려준다."""
    today = today or datetime.now(kit.KST).date().isoformat()
    if not should_nudge(state, today):
        return None
    _, p = current(env)
    if p["free"] <= 0 or p["next"]:
        return None
    try:
        with open(kit.ISSUES_JSON, encoding="utf-8") as fp:
            issues = json.load(fp)
    except FileNotFoundError:
        issues = {}
    issues ={k: v for k, v in issues.items() if isinstance(v, int)}

    def has_kit(label):
        return bool(glob.glob(os.path.join(kit_dir, f"*_{label}_{kit.CH_LABEL['naver']}.zip")))

    files = list_private_files()
    slugs = [label_to_slug(PRIVATE_TXT.match(n).group(1), issues) for n, _, _ in files]
    solo = fetch_naver_only(env, [s for s in slugs if s])
    msg = slot_nudge_message(p, private_backlog(files, issues, fetch_reviews(env), has_kit, naver_only=solo))
    if msg and notify(msg):
        state["slot_nudge_day"] = today
    log(f"칸 빔 알림: {msg}")
    return msg


def slots_full(env):
    """업무광고 칸(심사중, 지식인 제외 — plan 과 같은 셈)이 모두 찼는가."""
    limit, _ = load_queue()
    return sum(1 for r in fetch_reviews(env) if r.get("status") in ACTIVE) >= limit


def order_line(order, p=None):
    """운영표 한 줄 — 끝난 항목은 ✓, 키트 없는 항목은 (키트 대기)."""
    done = {(i["slug"], i["channel"]) for i in (p["done"] if p else [])}
    wait = {(i["slug"], i["channel"]) for i in (p["waiting"] if p else [])}
    held = {(i["slug"], i["channel"]) for i in (p.get("held", []) if p else [])}
    out = []
    for it in order:
        k = (it["slug"], it["channel"])
        s = label(it) + (" ✓" if k in done else " (본진 승인 대기)" if k in held
                         else " (키트 대기)" if k in wait else "")
        out.append(s)
    return " → ".join(out)


# ── 조회 ─────────────────────────────────────────────────────
def _epoch(ts):
    """ISO 시각 → epoch(초). 없거나 못 읽으면 None."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def fetch_reviews(env):
    url, h = kit._rest(env)
    rv = url.rsplit("/", 1)[0] + "/ad_reviews"
    rows = requests.get(rv, params={"select": "channel,status,posted_url,reviewed_at,premium_articles(slug)",
                                    "status": "in.(submitted,under_review,approved)", "channel": kit.NOT_KIN},
                        headers=h, timeout=30).json()
    return [{"slug": (r.get("premium_articles") or {}).get("slug"), "channel": r["channel"], "status": r["status"],
             "posted_url": r.get("posted_url"), "reviewed_at": _epoch(r.get("reviewed_at"))}
            for r in rows]


def fetch_titles(env):
    url, h = kit._rest(env)
    return {r["slug"]: r.get("title") for r in requests.get(url, params={"select": "slug,title"}, headers=h, timeout=30).json()}


def fetch_naver_only(env, slugs):
    """운영표 네이버 항목 중 네이버 단독 글(본진판 비어 있음 — kit.naver_only 와 같은 판정)."""
    slugs = sorted(set(slugs))
    if not slugs:
        return set()
    url, h = kit._rest(env)
    rows = requests.get(url, params={"select": "slug,main_website_markdown", "slug": f"in.({','.join(slugs)})"},
                        headers=h, timeout=30).json()
    return {r["slug"] for r in rows if kit.naver_only(r)}


def current(env, kit_dir=kit.KIT_DIR):
    limit, order = load_queue()
    kits = {(it["slug"], it["channel"]): find_kit(it, kit_dir) for it in order}
    kit_time = {k: os.path.getmtime(z) for k, z in kits.items() if z}
    solo = fetch_naver_only(env, [it["slug"] for it in order if it["channel"] == "naver"])
    reviews = fetch_reviews(env)
    kits = drop_prelink_naver_kits(order, reviews, kits, kit_time, naver_only=solo)
    return order, plan(order, reviews, kits, limit, naver_only=solo, waited=kit_time)


def notify_next(env, state, notify, log=print):
    """pams_auto 한 바퀴에서 부른다. 보냈으면 그 한 줄을 돌려준다."""
    order, p = current(env)
    go, sig = should_notify(p, state)
    if go:
        try:
            titles = fetch_titles(env)
        except Exception:   # 제목을 못 읽어도 알림은 보낸다(호수만)
            titles = None
        msg = held_message(p, state, titles)
        if notify(msg):
            if sig:
                state["queue_notified"] = sig
            state["held_kits"] = {}
        log(f"큐 알림: {msg}")
        return msg
    return None


# ── 본진 접수 → 네이버 비공개 게시 안내 자동 발송 ────────────────
GUIDE_MAX_TRY = 3


def naver_guides_due(order, reviews, state, extra=()):
    """순수: 안내를 보낼 글(slug) — 운영표의 네이버 항목 + extra(_네이버비공개 에 파일이 있는 글) 중,
    같은 글 본진이 **승인되고 게시 URL(posted_url)이 생겼고**(PAIR1 — 그래야 📄 본진 링크가 살아 있다)
    네이버는 아직 접수·승인 전이며, 안내를 보낸 적 없고, 실패 한도 전인 것.
    본진 승인 전에 만들어 둔 비공개 파일(링크 없음)은 이 안내가 다시 조립한 파일로 갈음한다."""
    done = {(r["slug"], r["channel"]) for r in reviews if r.get("status") in DONE}
    live = main_live(reviews)
    sent = state.get("naver_guide_sent") or {}
    fails = state.get("naver_guide_fail") or {}
    out = []
    for s in [it["slug"] for it in order if it["channel"] == "naver"] + list(extra):
        if s in out:
            continue
        if s in live and (s, "naver") not in done and s not in sent and fails.get(s, 0) < GUIDE_MAX_TRY:
            out.append(s)
    return out


def private_files_by_slug(files, issues=None):
    """_네이버비공개 txt [(이름, 경로, mtime)] → {slug: [이름 …]}. issues 를 안 주면 configs/issue_numbers.json."""
    if issues is None:
        try:
            with open(kit.ISSUES_JSON, encoding="utf-8") as fp:
                issues = {k: v for k, v in json.load(fp).items() if isinstance(v, int)}
        except FileNotFoundError:
            issues = {}
    out = {}
    for name, _, _ in files:
        m = PRIVATE_TXT.match(name)
        slug = label_to_slug(m.group(1), issues) if m else None
        if slug:
            out.setdefault(slug, []).append(name)
    return out


def relink_message(art, res, old):
    """본진 게시 뒤 다시 조립한 네이버 비공개 파일 알림 — 옛 파일(링크 없음)을 쓰지 않게."""
    return (f"🔗 [한 쌍] {kit.title_label(art.get('title'), art['slug'])} — 본진 게시됨 → 네이버 비공개 파일을 "
            f"📄 본진 링크 줄을 넣어 다시 만들었습니다: _네이버비공개\\{os.path.basename(res['txt'])}\n"
            f"옛 파일({', '.join(sorted(old))})은 본진 링크가 없어 쓰지 않습니다. "
            "이미 비공개로 올려 둔 글이 있으면 끝에 📄 줄을 넣고 PDF·상단 캡처를 다시 저장하세요.")


def send_naver_guides(env, state, notify, log=print, build=None, send=None, server_factory=None, private_files=None):
    """pams_auto 한 바퀴에서 부른다. 보낸 slug 목록을 돌려준다. 실패는 GUIDE_MAX_TRY 번까지 다음 바퀴에 다시.
    대상 = 운영표 네이버 항목 + _네이버비공개 에 파일이 있는 글 — 본진이 승인·게시(posted_url)된 뒤에만(PAIR1)."""
    import naver_private_guide as g
    build = build or g.build
    send = send or g.send
    server_factory = server_factory or (lambda: kit.LocalServer(port=3944, log=log))
    _, order = load_queue()
    files = private_files_by_slug(list_private_files() if private_files is None else private_files)
    due = naver_guides_due(order, fetch_reviews(env), state, extra=sorted(files))
    if not due:
        return []
    done = []
    with server_factory() as srv:
        for slug in due:
            art = None
            try:
                art = kit.fetch_article(env, slug)
                res = build(env, art, srv)
                send(env, res)
                state.setdefault("naver_guide_sent", {})[slug] = datetime.now(kit.KST).isoformat(timespec="minutes")
                log(f"네이버 비공개 게시 안내 발송: {kit.issue_label(slug)} ({os.path.basename(res['png'])})")
                old = [n for n in files.get(slug, []) if n != os.path.basename(res["txt"])]
                if old:   # 본진 승인 전에 만든 파일(📄 본진 링크 없음)이 남아 있다 — 헷갈리지 않게 한 줄
                    notify(relink_message(art, res, old))
                done.append(slug)
            except Exception as e:
                n = (state.setdefault("naver_guide_fail", {}).get(slug, 0)) + 1
                state["naver_guide_fail"][slug] = n
                log(f"네이버 안내 실패 {kit.issue_label(slug)} ({n}/{GUIDE_MAX_TRY}): {e}")
                if n >= GUIDE_MAX_TRY:
                    notify(f"[네이버 안내] {kit.title_label((art or {}).get('title'), slug)} 자동 발송 {GUIDE_MAX_TRY}회 실패 — "
                           f"수동: python scripts/naver_private_guide.py {slug} --send")
    return done


def main():
    env = kit.load_env()
    order, p = current(env)
    print("운영표:", order_line(order, p))
    print(f"심사중 {p['active']}/{p['limit']} · 빈 칸 {p['free']}")
    print(message(p, fetch_titles(env)) or "다음 접수: 없음(빈 칸 없음 또는 준비된 키트 없음)")


if __name__ == "__main__":
    main()
