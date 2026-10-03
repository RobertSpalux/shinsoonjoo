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
"""
import json
import os
import re
from datetime import datetime, timedelta

import requests

import pams_kit as kit

APPLY_JSON = r"D:\robert-os\finance\state\pams_apply_대기.json"
CHANNELS = {"본진": "main", "네이버": "naver"}
KEY_RX = re.compile(r"^\d{4}_(\d+)호_(본진|네이버)$")
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
        slug, ch = issue_slugs.get(int(m.group(1))), CHANNELS[m.group(2)]
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
    if kit_rec and kit_rec.get("hash"):
        lines.append(f"키트 해시 sha256 {kit_rec['hash']} ({os.path.basename(kit_rec.get('zip') or '')})")
    return "\n".join(lines)


def fetch_reviews(env):
    url, h = kit._rest(env)
    rows = requests.get(url.rsplit("/", 1)[0] + "/ad_reviews", headers=h, timeout=30,
                        params={"select": "channel,status,notes,premium_articles(slug)"}).json()
    return [{"slug": (r.get("premium_articles") or {}).get("slug"), "channel": r["channel"],
             "status": r["status"], "notes": r.get("notes")} for r in rows]


def issue_slugs():
    m = json.load(open(kit.ISSUES_JSON, encoding="utf-8"))
    return {v: k for k, v in m.items() if isinstance(v, int)}


def sync(env, state, notify, log=print, apply_path=APPLY_JSON, server_factory=None):
    """pams_auto 한 바퀴에서 부른다. 만든 행 [(slug, channel, id)]."""
    if not os.path.exists(apply_path):
        return []
    apply_map = json.load(open(apply_path, encoding="utf-8"))
    todo = pending(apply_map, fetch_reviews(env), issue_slugs(), datetime.now(kit.KST))
    # 관측 장치는 조용하면 작동 여부를 알 수 없다(CLAUDE.md §8) — 할 일이 없어도 한 줄 남긴다
    log(f"접수 행 점검: 접수 기록 {len(apply_map)}건 · 만들 행 {len(todo)}건")
    if not todo:
        return []
    import publish_approved as pa
    made = []
    with (server_factory() if server_factory else kit.LocalServer(port=3945, log=log)) as srv:
        for p in todo:
            art = kit.fetch_article(env, p["slug"])
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
