#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 → ad_reviews 행 자동 생성(본진·네이버).

왜: 사람이 PAMS 에서 [저장/제출]하면 robert-os 감시기는 PAMS 목록과 기존 ad_reviews 행을 **짝지어 갱신만** 한다.
    행을 새로 만드는 곳이 없어서, 접수 때마다 행이 빠졌다(7호 본진 10-01 · 8호 · 7호 네이버 · 9호 · 11호 · 13호 10-02).
    행이 없으면 감시기는 「짝없음」, 큐는 심사중 칸을 틀리게 세고(빈칸이 있다고 알림), 승인돼도 자동 공개가 안 된다.
어떻게: 감시기가 남기는 접수 기록 `robert-os/finance/state/pams_apply_대기.json` 의
    {"MMDD_N호_본진|네이버": {"게시명", "접수": {"진행사항": "심사중", "신청일시", "seq"?, "사람조작"?}}} 를 읽어,
    같은 글·채널에 진행 중/승인 행이 없고 그 seq 를 적은 행도 없으면 submitted 행을 만든다(어드민 /api/admin/ad-review submit).
    · 반송 → [보완] 재심의는 같은 seq 를 쓰고 감시기가 기존 행 상태를 바꾸므로 새 행을 만들지 않는다(notes 의 seq 로 구분).
    · 스레드는 게시명·행 규칙이 달라(pams_threads) 여기서 다루지 않는다.
    · 접수 기록이 days 일보다 오래된 것은 보지 않는다(옛 기록으로 행이 생기지 않게).

두 번째 길(LG1, 2026-11-04) — 감시기 「짝없음」 기록(`pams_짝없음.json`)
    왜: 신청서 채우기가 실패(pams_apply_*.json "ok": false)해 로버트가 손으로 제출하면 `pams_apply_대기.json` 에
        접수 항목이 생기지 않는다. 32호(seq 682637, 11/3)와 10/25 종신(673522)이 그렇게 ad_reviews 행 없이 지나갔다.
    어떻게: 감시기가 PAMS 목록에서 읽고도 ad_reviews 에 짝을 못 찾은 행(seq·게시명)을 키트 txt 의 「게시명:」,
        없으면 글 제목으로 (글, 채널) 하나에 맞춰 submitted 행을 만든다. 하나로 못 정하면 만들지 않고 알림 1회(seq+게시명 지문).
    · 이미 그 seq 를 notes 에 적은 행이 있으면 만들지 않는다(관제탑 수동 행과 중복 금지).
    · 같은 글·채널에 진행 중 행이 있으면 만들지 않는다(그 행의 짝짓기 실패는 사람이 본다 — 알림).
"""
import json
import os
import re
from datetime import datetime, timedelta

import requests

import pams_kit as kit

APPLY_JSON = r"D:\robert-os\finance\state\pams_apply_대기.json"
UNMATCHED_JSON = r"D:\robert-os\finance\state\pams_짝없음.json"
KIT_HEAD_RX = re.compile(r"^\[PAMS 접수 문자열\].*·\s*(본진|네이버)\s*·\s*([a-z0-9][a-z0-9-]*)\s*$")
KIT_TITLE_RX = re.compile(r"^게시명:\s*(.+?)\s*$", re.M)
CHANNELS = {"본진": "main", "네이버": "naver"}
# 키 중간은 「N호」(10/20 까지) 또는 글 slug(10/21 부터 키트 파일명이 MMDD_<slug>_채널 로 바뀜)
KEY_RX = re.compile(r"^\d{4}_(.+)_(본진|네이버)$")
ISSUE_RX = re.compile(r"^(\d+)호$")
SLUG_RX = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def key_slug(mid, issue_slugs):
    m = ISSUE_RX.match(mid)
    if m:
        return issue_slugs.get(int(m.group(1)))
    return mid if SLUG_RX.match(mid) else None
SEQ_RX = re.compile(r"seq=(\d+)")
ACTIVE = ("submitted", "under_review", "approved")


def entry_seq(e):
    j = e.get("접수") or {}
    if j.get("seq"):
        return str(j["seq"])
    m = SEQ_RX.search(j.get("사람조작") or "")
    return m.group(1) if m else None


def pending(apply_map, reviews, issue_slugs, now, days=3):
    """순수: 만들 행 목록 → [{slug, channel, seq, 신청일시, 게시명, 시각}].
    reviews: [{slug, channel, status, notes}] · issue_slugs: {호수(int): slug}."""
    out = []
    for key, e in (apply_map or {}).items():
        m = KEY_RX.match(key)
        j = (e or {}).get("접수") or {}
        if not m or j.get("진행사항") != "심사중":
            continue
        slug, ch = key_slug(m.group(1), issue_slugs), CHANNELS[m.group(2)]
        seq = entry_seq(e)
        if not slug or not seq:
            continue
        try:
            at = datetime.fromisoformat(j.get("시각") or "")
        except ValueError:
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=kit.KST)
        if now - at > timedelta(days=days):
            continue
        rows = [r for r in reviews if r.get("slug") == slug and r.get("channel") == ch]
        if any(r.get("status") in ACTIVE for r in rows) or any(f"seq {seq}" in (r.get("notes") or "") for r in rows):
            continue
        out.append({"slug": slug, "channel": ch, "seq": seq, "신청일시": j.get("신청일시") or "",
                    "게시명": (e.get("게시명") or "").strip(), "시각": j.get("시각") or ""})
    return out


def note_for(p, kit_rec=None):
    lines = [f"PAMS 실제 접수 {p['신청일시']}(PAMS seq {p['seq']} · 감시기 「심사중」 {p['시각'][:16]}). "
             f"행은 pams_auto 자동 생성(pams_submissions)"]
    if p.get("via"):
        lines.append(f"감시기 짝없음 경로(LG1) — {p['via']}로 글·채널을 맞춤 · 생성 시 PAMS 진행사항 「{p.get('pams_state', '')}」")
    if kit_rec and kit_rec.get("hash"):
        lines.append(f"키트 해시 sha256 {kit_rec['hash']} ({os.path.basename(kit_rec.get('zip') or '')})")
    return "\n".join(lines)


def fetch_reviews(env):
    url, h = kit._rest(env)
    rows = requests.get(url.rsplit("/", 1)[0] + "/ad_reviews", headers=h, timeout=30,
                        params={"select": "channel,status,notes,premium_articles(slug)", "channel": kit.NOT_KIN}).json()
    return [{"slug": (r.get("premium_articles") or {}).get("slug"), "channel": r["channel"],
             "status": r["status"], "notes": r.get("notes")} for r in rows]


def issue_slugs():
    m = json.load(open(kit.ISSUES_JSON, encoding="utf-8"))
    return {v: k for k, v in m.items() if isinstance(v, int)}


def _norm(s):
    """pams_wheel.norm 과 같은 규칙 — 글자·숫자만, 소문자."""
    return re.sub(r"[^0-9A-Za-z가-힣]", "", s or "").lower()


def _same_title(a, b):
    """pams_wheel.match_row 의 제목 비교와 같다 — 같거나, 한쪽이 다른 쪽 앞 14자로 시작하거나, 포함."""
    a, b = _norm(a), _norm(b)
    if len(a) < 14 or len(b) < 14:
        return a == b and bool(a)
    return a.startswith(b[:14]) or b.startswith(a[:14]) or a in b or b in a


def kit_titles(roots):
    """키트 txt → [(slug, channel, 게시명)]. 폴더는 하위(_접수완료 등)까지 본다. 읽지 못하는 파일은 건너뛴다."""
    out = []
    for root in roots:
        for d, _, files in os.walk(root):
            for fn in files:
                if not fn.endswith(".txt"):
                    continue
                try:
                    txt = open(os.path.join(d, fn), encoding="utf-8").read()
                except (OSError, UnicodeDecodeError):
                    continue
                m = KIT_HEAD_RX.match(txt.split("\n", 1)[0].strip())
                t = KIT_TITLE_RX.search(txt)
                if m and t:
                    out.append((m.group(2), CHANNELS[m.group(1)], t.group(1)))
    return out


def pending_unmatched(rows, reviews, articles, kits, now, days=14):
    """순수: 감시기 「짝없음」 행 → (만들 목록, 못 맞춘 목록).
    rows: pams_짝없음.json 의 행 · reviews: fetch_reviews() · articles: [{slug,title,naver_title,ad_reviews}]
    kits: kit_titles() · 만들 목록 항목은 pending() 과 같은 모양, 못 맞춘 항목은 {seq, 게시명, 사유}."""
    todo, unmatched = [], []
    for e in rows or []:
        seq, name = str(e.get("seq") or "").strip(), (e.get("게시명") or "").strip()
        if not seq or not name:
            continue
        if any(re.search(rf"seq {seq}(?!\d)", r.get("notes") or "") for r in reviews):
            continue   # 이미 이 접수번호를 적은 행이 있다(관제탑 수동 행 포함) — 감시기가 제목 때문에 못 짝지은 것일 뿐
        try:
            at = datetime.fromisoformat((e.get("신청일시") or "").replace(" ", "T"))
            if at.tzinfo is None:
                at = at.replace(tzinfo=kit.KST)
            if now - at > timedelta(days=days):
                continue
        except ValueError:
            pass   # 신청일시를 못 읽어도 만들기를 막지 않는다 — 날짜는 안전장치일 뿐
        hits = {(s, c) for s, c, t in kits if _same_title(name, t)}
        via = "키트 txt 게시명"
        if not hits:
            via = "글 제목"
            for a in articles:
                for ch in ("main", "naver"):
                    if _same_title(name, kit.posting_title(a, ch)[0]):
                        hits.add((a["slug"], ch))
        if len(hits) != 1:
            unmatched.append({"seq": seq, "게시명": name,
                              "사유": "후보 없음" if not hits else f"후보 {len(hits)}개({', '.join(f'{s}/{c}' for s, c in sorted(hits))})"})
            continue
        slug, ch = next(iter(hits))
        if any(r.get("slug") == slug and r.get("channel") == ch and r.get("status") in ACTIVE for r in reviews):
            unmatched.append({"seq": seq, "게시명": name, "사유": f"{slug}/{ch} 에 진행 중 행이 이미 있음(seq 가 notes 에 없음)"})
            continue
        # 게시명은 비운다 — 감시기가 읽은 PAMS 목록 게시명은 공백·문장부호가 떨어져 있어 행 제목으로 쓰면 안 된다
        todo.append({"slug": slug, "channel": ch, "seq": seq, "신청일시": e.get("신청일시") or "",
                     "게시명": "", "시각": e.get("신청일시") or "", "via": via, "pams_state": e.get("진행사항") or ""})
    return todo, unmatched


def fetch_articles(env):
    url, h = kit._rest(env)
    return requests.get(url, headers=h, timeout=30,
                        params={"select": "slug,title,naver_title,ad_reviews(channel,posting_title,created_at)"}).json()


def unmatched_todo(env, state, notify, log, path=UNMATCHED_JSON, reviews=None, articles=None, kits=None):
    """짝없음 파일 → (만들 목록). 못 맞춘 건은 seq+게시명 지문으로 한 번만 알린다."""
    if not os.path.exists(path):
        return []
    rows = (json.load(open(path, encoding="utf-8")) or {}).get("행") or []
    if not rows:
        return []
    todo, bad = pending_unmatched(
        rows, reviews if reviews is not None else fetch_reviews(env),
        articles if articles is not None else fetch_articles(env),
        kits if kits is not None else kit_titles([kit.KIT_DIR]), datetime.now(kit.KST))
    seen = state.setdefault("unmatched_alerted", {})
    for b in bad:
        fp = f"{b['seq']}:{_norm(b['게시명'])[:40]}"
        if fp in seen:
            continue
        seen[fp] = datetime.now(kit.KST).isoformat()
        msg = (f"⚠️ PAMS 접수 seq {b['seq']} 의 ad_reviews 행을 자동으로 만들지 못했습니다 — {b['사유']}\n"
               f"게시명: {b['게시명'][:60]}\n관제탑에서 행을 만들어 주세요(notes 에 「PAMS seq {b['seq']}」).")
        log(msg.replace("\n", " / "))
        notify(msg)
    return todo


def sync(env, state, notify, log=print, apply_path=APPLY_JSON, server_factory=None, unmatched_path=UNMATCHED_JSON):
    """pams_auto 한 바퀴에서 부른다. 만든 행 [(slug, channel, id)]."""
    todo = []
    if os.path.exists(apply_path):
        apply_map = json.load(open(apply_path, encoding="utf-8"))
        todo = pending(apply_map, fetch_reviews(env), issue_slugs(), datetime.now(kit.KST))
        log(f"접수 행 점검: 접수 기록 {len(apply_map)}건 · 만들 행 {len(todo)}건")
    extra = unmatched_todo(env, state, notify, log, path=unmatched_path)
    have = {p["seq"] for p in todo}
    todo += [p for p in extra if p["seq"] not in have]
    if extra:
        log(f"접수 행 점검(짝없음 경로): 만들 행 {len(extra)}건")
    # 관측 장치는 조용하면 작동 여부를 알 수 없다(CLAUDE.md §8) — 할 일이 없어도 한 줄 남긴다(위 log)
    if not todo:
        return []
    import publish_approved as pa
    made = []
    with (server_factory() if server_factory else kit.LocalServer(port=3945, log=log)) as srv:
        for p in todo:
            try:
                art = kit.fetch_article(env, p["slug"])
            except Exception as e:  # 키 중간이 slug 가 아닌 글이면 이 건만 건너뛴다(나머지 행은 계속 만든다)
                log(f"접수 행 건너뜀 — {p['slug']} 글 조회 실패: {e}")
                continue
            title = p["게시명"] or kit.posting_title(art, p["channel"])[0]
            kit_rec = (state.get("kits") or {}).get(f"{p['slug']}|{p['channel']}")
            r = pa.admin_post(srv, env, "/api/admin/ad-review", {
                "action": "submit", "articleId": art["id"], "channel": p["channel"], "postingTitle": title,
                "adForm": "홈페이지" if p["channel"] == "main" else "바이럴(블로그 등)",
                "reviewType": "general", "notes": note_for(p, kit_rec)})
            rid = (r.get("review") or {}).get("id", "")
            made.append((p["slug"], p["channel"], rid))
            msg = (f"🧾 PAMS 접수 기록 — {kit.title_label(art.get('title'), p['slug'])} {kit.CH_LABEL[p['channel']]} "
                   f"(seq {p['seq']} · {p['신청일시']}) → ad_reviews 행 생성 {rid[:8]}")
            log(msg)
            notify(msg)
    return made
