#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
유효 리드 주간 리포트 — 매주 월 08:50 PAMS 알림방(TELEGRAM_CHAT_ID = Soonjoo_PB)으로 1통.

    python scripts/weekly_lead_report.py                 # 드라이런(지난주 월~일) — 출력만
    python scripts/weekly_lead_report.py --send          # 발송
    python scripts/weekly_lead_report.py --install       # 작업 스케줄러: 매주 월 08:50 --send
    python scripts/weekly_lead_report.py --week-of 2026-09-22   # 그 주(월요일) 기준으로

지표 = **유효 리드 수**(질 우선). 조회수·팔로워는 넣지 않는다(지표 아님).
  ① 진단 퍼널(GA4 이벤트): diagnosis_start → diagnosis_complete → kakao_cta_click(position=diagnosis_result)
  ② 글별 유입: GA4 세션(착지 /news/<slug>) 을 유입원(네이버 블로그·스레드·검색·기타)으로 나눔 + GSC 검색 클릭(페이지별)
  ③ ad_reviews: 승인(reviewed_at) · 게시위치 등록(url_registered_at = 게시 완료 증빙) 건수
  ④ 스레드 댓글(@goodfinance_sj): robert-os finance/state/replies.json **읽기만** — 받은 댓글·답글 단 수
숫자 옆에 전주 대비(▲▼).

자격증명 = robert-os 관제판과 같은 것을 **재사용**(새 키 없음):
  D:\\robert-os\\shared\\.env 의 GA_SERVICE_ACCOUNT_JSON · GA4_PROPERTY_ID_GOODFINANCE · SEARCH_CONSOLE_SITES
  (값은 읽기만, 로그·출력에 남기지 않는다.) 조회 실패는 그 칸만 「조회 실패」로 두고 나머지는 보낸다.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402

KST = timezone(timedelta(hours=9))
ROBERT_OS_ENV = os.environ.get("ROBERT_OS_ENV", r"D:\robert-os\shared\.env")
REPLIES_JSON = os.environ.get("ROBERT_OS_REPLIES", r"D:\robert-os\finance\state\replies.json")
SITE_HOST = "goodfinance.kr"
TASK_NAME = "SHIN_weekly_lead_report"
FUNNEL = [("diagnosis_start", "퀴즈 시작"), ("diagnosis_complete", "퀴즈 완료"), ("kakao_cta_click", "카카오 대화창 열기")]
GA4_SCOPE = ["https://www.googleapis.com/auth/analytics.readonly"]
GSC_SCOPE = ["https://www.googleapis.com/auth/webmasters.readonly"]


# ── 기간 · 표시(순수) ─────────────────────────────────────────
def last_week(today):
    """today 기준 지난주 월~일, 그 전주 월~일."""
    mon = today - timedelta(days=today.weekday() + 7)
    return (mon, mon + timedelta(days=6)), (mon - timedelta(days=7), mon - timedelta(days=1))


def delta(cur, prev):
    """「12 (▲3)」 꼴. 비교 불가면 숫자만."""
    if cur is None:
        return "조회 실패"
    if prev is None:
        return f"{cur}"
    d = cur - prev
    return f"{cur} ({'▲' if d > 0 else '▼' if d < 0 else '＝'}{abs(d) if d else ''})".replace("(＝)", "(＝)")


def rate(a, b):
    return f"{round(a * 100 / b)}%" if a is not None and b else "—"


def source_bucket(source, medium):
    s, m = (source or "").lower(), (medium or "").lower()
    if "blog.naver" in s:
        return "네이버 블로그"
    if "threads" in s or s in ("l.threads.com", "threads.net"):
        return "스레드"
    if m == "organic":
        return "검색"
    return "기타"


def slug_of(path):
    m = re.match(r"^/news/([^/?#]+)", path or "")
    return m.group(1) if m else None


def in_range(ts, start, end):
    """ts(ISO 문자열|None) 가 KST 날짜로 [start, end] 안인가."""
    if not ts:
        return False
    try:
        t = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=KST)
    d = t.astimezone(KST).date()
    return start <= d <= end


def count_replies(db, start, end, account="goodfinance"):
    """replies.json(댓글 dict) → (받은 댓글, 답글 단 수). 본문·작성자는 보지 않는다."""
    got = done = 0
    for v in (db or {}).values():
        if v.get("계정") != account:
            continue
        if in_range(v.get("때") or v.get("처음본시각"), start, end):
            got += 1
        if in_range(v.get("답글시각"), start, end):
            done += 1
    return got, done


def compose(week, prev, cur_m, prev_m, labels):
    """리포트 본문(텔레그램 1통)."""
    (s, e) = week
    L = [f"[유효 리드 주간] {s:%m.%d}~{e:%m.%d} (전주 대비)", ""]
    f, pf = cur_m.get("funnel"), prev_m.get("funnel") or {}
    L.append("① 진단 퍼널")
    if f is None:
        L.append("  조회 실패(GA4)")
    else:
        n0, n1, n2 = (f.get(k) for k, _ in FUNNEL)
        L.append(f"  시작 {delta(n0, pf.get(FUNNEL[0][0]))} → 완료 {delta(n1, pf.get(FUNNEL[1][0]))} "
                 f"→ 카카오 {delta(n2, pf.get(FUNNEL[2][0]))}")
        L.append(f"  완료율 {rate(n1, n0)} · 카카오 전환 {rate(n2, n1)}")
        L.append("  · 진단 결과의 카카오 버튼만 셈. variant 구분 없음(A/B 미배포)")
    L.append("")
    L.append("② 글별 유입(goodfinance.kr /news, 세션 · 검색 클릭)")
    arts, parts = cur_m.get("articles"), prev_m.get("articles") or {}
    if arts is None:
        L.append("  조회 실패(GA4)")
    elif not arts:
        L.append("  유입 0")
    else:
        shown = [(s_, r_) for s_, r_ in arts.items() if r_.get("합계") or r_.get("검색클릭")]
        for slug, row in sorted(shown, key=lambda kv: (-kv[1]["합계"], -(kv[1].get("검색클릭") or 0)))[:8]:
            p = (parts.get(slug) or {})
            src = " · ".join(f"{k} {v}" for k, v in row.items() if k not in ("합계", "검색클릭") and v)
            gsc = row.get("검색클릭")
            L.append(f"  {labels.get(slug, slug)} {delta(row['합계'], p.get('합계'))}"
                     + (f" — {src}" if src else "") + (f" · 검색클릭 {gsc}" if gsc else ""))
    L.append("")
    r, pr = cur_m.get("reviews"), prev_m.get("reviews") or {}
    L.append("③ 심의·게시")
    L.append("  조회 실패(DB)" if r is None else
             f"  승인 {delta(r['승인'], pr.get('승인'))} · 게시위치 등록 {delta(r['게시'], pr.get('게시'))}")
    L.append("")
    t, pt = cur_m.get("threads"), prev_m.get("threads") or {}
    L.append("④ 스레드 댓글(@goodfinance_sj)")
    L.append("  조회 실패(replies.json)" if t is None else
             f"  받은 댓글 {delta(t['받음'], pt.get('받음'))} · 답글 {delta(t['답글'], pt.get('답글'))}")
    return "\n".join(L)


# ── 조회 ─────────────────────────────────────────────────────
def load_ros_env(path=ROBERT_OS_ENV):
    env = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8-sig"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _svc(ros, api, ver, scopes):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(ros["GA_SERVICE_ACCOUNT_JSON"], scopes=scopes)
    return build(api, ver, credentials=creds, cache_discovery=False)


def ga4_funnel(ros, start, end):
    svc = _svc(ros, "analyticsdata", "v1beta", GA4_SCOPE)
    body = {"dateRanges": [{"startDate": str(start), "endDate": str(end)}],
            "dimensions": [{"name": "eventName"}, {"name": "customEvent:position"}],
            "metrics": [{"name": "eventCount"}],
            "dimensionFilter": {"filter": {"fieldName": "eventName", "inListFilter": {"values": [k for k, _ in FUNNEL]}}}}
    try:
        rows = svc.properties().runReport(property=f"properties/{ros['GA4_PROPERTY_ID_GOODFINANCE']}", body=body).execute().get("rows", [])
        by_pos = True
    except Exception:   # position 이 커스텀 측정기준으로 등록 안 돼 있으면 이름만으로
        body["dimensions"] = [{"name": "eventName"}]
        rows = svc.properties().runReport(property=f"properties/{ros['GA4_PROPERTY_ID_GOODFINANCE']}", body=body).execute().get("rows", [])
        by_pos = False
    out = {k: 0 for k, _ in FUNNEL}
    for r in rows:
        dims = [d["value"] for d in r["dimensionValues"]]
        name, n = dims[0], int(r["metricValues"][0]["value"])
        if name == "kakao_cta_click" and by_pos and dims[1] not in ("diagnosis_result",):
            continue
        out[name] = out.get(name, 0) + n
    return out


def ga4_articles(ros, start, end):
    svc = _svc(ros, "analyticsdata", "v1beta", GA4_SCOPE)
    body = {"dateRanges": [{"startDate": str(start), "endDate": str(end)}],
            "dimensions": [{"name": "landingPage"}, {"name": "sessionSource"}, {"name": "sessionMedium"}],
            "metrics": [{"name": "sessions"}],
            "dimensionFilter": {"filter": {"fieldName": "landingPage", "stringFilter": {"matchType": "BEGINS_WITH", "value": "/news/"}}},
            "limit": 1000}
    rows = svc.properties().runReport(property=f"properties/{ros['GA4_PROPERTY_ID_GOODFINANCE']}", body=body).execute().get("rows", [])
    out = defaultdict(lambda: Counter())
    for r in rows:
        path, src, med = (d["value"] for d in r["dimensionValues"])
        slug = slug_of(path)
        if not slug:
            continue
        n = int(r["metricValues"][0]["value"])
        out[slug][source_bucket(src, med)] += n
        out[slug]["합계"] += n
    return {k: dict(v) for k, v in out.items()}


def gsc_clicks(ros, start, end):
    sites = [s.strip() for s in ros.get("SEARCH_CONSOLE_SITES", "").split(",") if SITE_HOST in s]
    if not sites:
        return {}
    svc = _svc(ros, "searchconsole", "v1", GSC_SCOPE)
    rows = svc.searchanalytics().query(siteUrl=sites[0], body={
        "startDate": str(start), "endDate": str(end), "dimensions": ["page"], "rowLimit": 500}).execute().get("rows", [])
    out = {}
    for r in rows:
        slug = slug_of(re.sub(r"^https?://[^/]+", "", r["keys"][0]))
        if slug:
            out[slug] = out.get(slug, 0) + int(r.get("clicks", 0))
    return out


def review_counts(env, start, end):
    url, h = kit._rest(env)
    rv = url.rsplit("/", 1)[0] + "/ad_reviews"
    rows = requests.get(rv, params={"select": "status,reviewed_at,review_from,url_registered_at"}, headers=h, timeout=30).json()
    ok = sum(1 for r in rows if r.get("status") == "approved" and in_range(r.get("reviewed_at") or r.get("review_from"), start, end))
    posted = sum(1 for r in rows if in_range(r.get("url_registered_at"), start, end))
    return {"승인": ok, "게시": posted}


def labels(env):
    url, h = kit._rest(env)
    rows = requests.get(url, params={"select": "slug,title"}, headers=h, timeout=30).json()
    return {r["slug"]: kit.title_label(r.get("title"), r["slug"]) for r in rows}   # 글 제목 (N호) — 호수 없으면 제목만


def measure(env, ros, start, end, log):
    m = {}
    for key, fn in (("funnel", lambda: ga4_funnel(ros, start, end)),
                    ("articles", lambda: ga4_articles(ros, start, end)),
                    ("reviews", lambda: review_counts(env, start, end))):
        try:
            m[key] = fn()
        except Exception as e:
            log(f"{key} 조회 실패: {type(e).__name__}: {str(e)[:160]}")
            m[key] = None
    try:
        g = gsc_clicks(ros, start, end)
        for slug, c in g.items():
            if m.get("articles") is not None:
                m["articles"].setdefault(slug, {"합계": 0})["검색클릭"] = c
    except Exception as e:
        log(f"gsc 조회 실패: {type(e).__name__}: {str(e)[:160]}")
    try:
        db = json.load(open(REPLIES_JSON, encoding="utf-8")).get("댓글", {})
        got, done = count_replies(db, start, end)
        m["threads"] = {"받음": got, "답글": done}
    except Exception as e:
        log(f"replies 조회 실패: {e}")
        m["threads"] = None
    return m


def send(env, text):
    token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      data={"chat_id": chat, "text": text, "disable_web_page_preview": "true"}, timeout=30)
    return r.ok and r.json().get("ok", False)


def install():
    import pams_auto   # 같은 인터프리터 규칙(시스템 Python — 남의 venv 에 묶이지 않게)
    tr = f'"{pams_auto.pythonw()}" "{os.path.abspath(__file__)}" --send'
    r = subprocess.run(["schtasks", "/Create", "/TN", TASK_NAME, "/SC", "WEEKLY", "/D", "MON", "/ST", "08:50",
                        "/TR", tr, "/F"], capture_output=True, text=True)
    print(r.stdout or r.stderr)
    return r.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true")
    ap.add_argument("--install", action="store_true")
    ap.add_argument("--week-of", help="그 주 월요일(YYYY-MM-DD). 기본 = 지난주")
    a = ap.parse_args()
    if a.install:
        sys.exit(install())
    env, ros = kit.load_env(), load_ros_env()
    if a.week_of:
        mon = date.fromisoformat(a.week_of)
        week, prev = (mon, mon + timedelta(days=6)), (mon - timedelta(days=7), mon - timedelta(days=1))
    else:
        week, prev = last_week(datetime.now(KST).date())
    logs = []
    cur = measure(env, ros, *week, log=logs.append)
    pre = measure(env, ros, *prev, log=lambda *_: None)
    text = compose(week, prev, cur, pre, labels(env))
    print(text)
    for l in logs:
        print("· " + l, file=sys.stderr)
    if a.send:
        print("발송:", "완료" if send(env, text) else "실패")


if __name__ == "__main__":
    main()
