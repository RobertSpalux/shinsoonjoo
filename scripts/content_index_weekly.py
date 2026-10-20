#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
주간 유입 지수(IX1) — 매주 월 08:00 KST, 지난주(월~일) 글별 검색 노출·유입·전환을 재서 표에 쌓는다.

    python scripts/content_index_weekly.py                    # 드라이런 — 재고 출력만(DB·텔레그램 안 씀)
    python scripts/content_index_weekly.py --save --send      # content_index_weekly upsert + Soonjoo_PB 방 요약 1통
    python scripts/content_index_weekly.py --install          # 작업 스케줄러: 매주 월 08:00 --save --send
    python scripts/content_index_weekly.py --week-of 2026-10-12   # 그 주(월요일) 기준
    python scripts/content_index_weekly.py --only naver       # naver | main (한쪽만)

측정(전부 읽기 전용 — 쓰는 곳은 content_index_weekly 하나, sql/009):
  ① 네이버(insightlab-daily): 글마다 핵심 검색어(premium_articles.main_keyword, 비면 제목 앞 3어절 = auto)로
     블로그탭 순위(30위까지) · 통합검색 첫 화면 노출(블로그·본진). 공개 검색 GET, 요청 사이 1.2초.
     ⚠️ 순위는 **측정한 순간(월요일 아침)** 값이다. 네이버는 주 단위 집계가 없다.
  ② 본진 GSC: /news/<slug> 노출·클릭·평균순위·상위 검색어 5. GSC 는 2~3일 늦게 차므로
     지난주가 아니라 **실행일 −3일까지의 7일**을 잰다(gsc_from·gsc_to 로 기록).
  ③ 본진 GA4: 착지 /news/<slug> 세션(유입원별) · 전환 이벤트(generate_lead·kakao_click·diagnosis_complete·tel_click)
     — 전환은 「그 글로 들어온 세션에서 일어난 수」(landingPage × eventName).

판정(표·텔레그램에 표시):
  네이버 블로그탭 30위 밖 = 「갱신 대상」 · 4~15위 = 「보강 대상」 · 본진 노출 있는데 클릭 0 = 「제목·설명 개선 대상」.
  판정은 표시만 한다 — 글을 고치는 것은 사람이다(심의 받은 글 본문 수정 = 재심의, CLAUDE.md §6.4).

자격증명 = weekly_lead_report 와 같다(.env.local + D:\\robert-os\\shared\\.env 의 GA_SERVICE_ACCOUNT_JSON ·
GA4_PROPERTY_ID_GOODFINANCE · SEARCH_CONSOLE_SITES). 조회 실패는 그 칸만 null + errors 에 남기고 나머지는 진행한다.
"""
import argparse
import html as html_lib
import os
import re
import subprocess
import sys
import time
import urllib.parse
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
from weekly_lead_report import last_week, load_ros_env  # noqa: E402

KST = timezone(timedelta(hours=9))
TASK_NAME = "SHIN_content_index_weekly"
OURS = "insightlab-daily"
SITE_HOST = "goodfinance.kr"
CONV_EVENTS = ("generate_lead", "kakao_click", "diagnosis_complete", "tel_click")
CONV_LABEL = {"generate_lead": "상담신청", "kakao_click": "카톡", "diagnosis_complete": "진단완료", "tel_click": "전화"}
NAVER_GAP = 1.2
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9"}
V_REFRESH, V_BOOST, V_SNIPPET = "갱신 대상", "보강 대상", "제목·설명 개선 대상"
GA4_SCOPE = ["https://www.googleapis.com/auth/analytics.readonly"]
GSC_SCOPE = ["https://www.googleapis.com/auth/webmasters.readonly"]


# ── 순수 ─────────────────────────────────────────────────────
def auto_keyword(title):
    """제목 앞부분(구분자 앞) 3어절 — main_keyword 가 비었을 때의 대체 검색어(관제탑 naver_rank.py 와 같은 규칙)."""
    t = re.split(r"[—\-–|:?]", title or "")[0].strip()
    w = t.split()
    return " ".join(w[:3]) if len(w) > 3 else t


def keyword_for(article):
    k = (article.get("main_keyword") or "").strip()
    if k:
        return k, "main_keyword"
    k = auto_keyword(article.get("naver_title") or article.get("title") or "")
    return (k, "auto") if k else (None, None)


def blog_posts(page_html):
    """블로그탭 결과 HTML → [(블로그ID, logNo)] 중복 없이 나온 순서대로."""
    seen = []
    for m in re.finditer(r"blog\.naver\.com/([A-Za-z0-9_\-]+)/(\d{6,})", page_html):
        k = (m.group(1), m.group(2))
        if k not in seen:
            seen.append(k)
    return seen


def our_rank(posts, log_no=None):
    """(순위|None, 센 글 수, 잡힌 우리 글이 이 글인가|None). 이 글(logNo)이 있으면 그 순위, 없으면 우리 블로그 첫 글."""
    mine = [(i, n) for i, (b, n) in enumerate(posts, 1) if b == OURS]
    if log_no:
        for i, n in mine:
            if n == log_no:
                return i, len(posts), True
    if mine:
        return mine[0][0], len(posts), (False if log_no else None)
    return None, len(posts), None


def naver_log_no(url):
    m = re.search(r"blog\.naver\.com/[A-Za-z0-9_\-]+/(\d{6,})", url or "") or re.search(r"logNo=(\d{6,})", url or "")
    return m.group(1) if m else None


def source_bucket(source):
    s = (source or "").lower()
    if "blog.naver" in s:
        return "네이버 블로그"
    if "naver" in s:
        return "네이버 검색"
    if "threads" in s:
        return "스레드"
    if s in ("google", "bing", "daum", "yahoo") or "search" in s or "gemini" in s or "chatgpt" in s:
        return "구글·기타 검색"
    if s == "(direct)":
        return "직접"
    return "기타"


def is_internal_source(source):
    s = (source or "").lower()
    return s.startswith("localhost") or s.startswith("127.0.0.1") or s == "pams.kr"


def slug_of(path):
    m = re.match(r"^/news/([^/?#]+)", path or "")
    return urllib.parse.unquote(m.group(1)) if m else None


def verdicts(row):
    """판정 — 표시용 문자열 목록. 측정 실패(null)는 판정하지 않는다."""
    out = []
    if row.get("naver_measured"):
        r = row.get("naver_blog_rank")
        if r is None or r > 30:
            out.append(V_REFRESH)
        elif 4 <= r <= 15:
            out.append(V_BOOST)
    if (row.get("gsc_impressions") or 0) > 0 and row.get("gsc_clicks") == 0:
        out.append(V_SNIPPET)
    return out


def arrow(cur, prev):
    """순위 변화 — 숫자가 작을수록 좋다. ▲ = 올라감."""
    if cur is None and prev is None:
        return ""
    if prev is None:
        return "new"
    if cur is None:
        return "▼밖"
    if cur < prev:
        return f"▲{prev - cur}"
    if cur > prev:
        return f"▼{cur - prev}"
    return "＝"


def gsc_window(today):
    end = today - timedelta(days=3)
    return end - timedelta(days=6), end


def compose(week, rows, prev, labels):
    """텔레그램 요약 1통."""
    s, e = week
    L = [f"[유입 지수 주간] {s:%m.%d}~{e:%m.%d}", ""]
    by_v = defaultdict(list)
    for r in rows:
        for v in r["verdicts"]:
            by_v[v].append(r)
    nav = [r for r in rows if r.get("naver_measured")]
    top30 = [r for r in nav if r.get("naver_blog_rank") is not None and r["naver_blog_rank"] <= 30]
    L.append(f"① 네이버 블로그탭(측정 {len(nav)}편): 30위 안 {len(top30)}편 · 통합검색 노출 "
             f"{sum(1 for r in nav if r.get('naver_integ_blog'))}편")
    for r in sorted(top30, key=lambda r: r["naver_blog_rank"])[:8]:
        p = (prev.get(r["slug"]) or {}).get("naver_blog_rank")
        L.append(f"  {r['naver_blog_rank']}위 {arrow(r['naver_blog_rank'], p)} 「{r['keyword']}」 {labels.get(r['slug'], r['slug'])}")
    L.append("")
    main = [r for r in rows if r.get("gsc_impressions") is not None or r.get("ga_sessions") is not None]
    imp = sum(r.get("gsc_impressions") or 0 for r in main)
    clk = sum(r.get("gsc_clicks") or 0 for r in main)
    ses = sum(r.get("ga_sessions") or 0 for r in main)
    L.append(f"② 본진: GSC 노출 {imp} · 클릭 {clk} · 글 착지 세션 {ses}")
    conv = Counter()
    for r in rows:
        conv.update(r.get("conv_events") or {})
    L.append("③ 전환(글 착지 세션 기준): " + " · ".join(f"{CONV_LABEL[k]} {conv.get(k, 0)}" for k in CONV_EVENTS))
    L.append("")
    for v in (V_REFRESH, V_BOOST, V_SNIPPET):
        items = by_v.get(v) or []
        L.append(f"■ {v} {len(items)}편")
        for r in items[:6]:
            L.append(f"  · {labels.get(r['slug'], r['slug'])}")
        if len(items) > 6:
            L.append(f"  · 외 {len(items) - 6}편")
    errs = sorted({k for r in rows for k in (r.get("errors") or {})})
    if errs:
        L += ["", "※ 조회 실패: " + ", ".join(errs)]
    L += ["", "표: /admin → 유입 지수"]
    return "\n".join(L)


# ── 조회 ─────────────────────────────────────────────────────
def _rest_table(env, table):
    url, h = kit._rest(env)
    return url.rsplit("/", 1)[0] + "/" + table, h


def fetch_articles(env):
    url, h = kit._rest(env)
    base = "id,slug,title,naver_title,is_main_published,is_naver_published"
    r = requests.get(url, params={"select": base + ",main_keyword", "order": "created_at.desc"}, headers=h, timeout=30)
    if r.status_code == 400 and "main_keyword" in r.text:   # sql/009 적용 전 — 전부 auto
        r = requests.get(url, params={"select": base, "order": "created_at.desc"}, headers=h, timeout=30)
    r.raise_for_status()
    return [a for a in r.json() if a.get("is_main_published") or a.get("is_naver_published")]


def fetch_naver_urls(env):
    url, h = _rest_table(env, "ad_reviews")
    r = requests.get(url, params={"select": "article_id,posted_url,created_at", "channel": "eq.naver",
                                  "posted_url": "not.is.null", "order": "created_at.desc"}, headers=h, timeout=30)
    r.raise_for_status()
    out = {}
    for row in r.json():
        n = naver_log_no(row.get("posted_url"))
        if row.get("article_id") and n:
            out.setdefault(row["article_id"], n)
    return out


def fetch_prev(env, week_start):
    url, h = _rest_table(env, "content_index_weekly")
    r = requests.get(url, params={"select": "slug,naver_blog_rank,gsc_position,gsc_clicks",
                                  "week_start": f"eq.{week_start - timedelta(days=7)}"}, headers=h, timeout=30)
    if r.status_code != 200:
        return {}
    return {x["slug"]: x for x in r.json()}


def http_get(u):
    r = requests.get(u, headers=UA, timeout=20)
    r.raise_for_status()
    return r.text


def naver_measure(keyword, log_no, get=http_get, sleep=time.sleep):
    blog = get("https://search.naver.com/search.naver?ssc=tab.blog.all&query=" + urllib.parse.quote(keyword))
    sleep(NAVER_GAP)
    rank, n, matched = our_rank(blog_posts(blog), log_no)
    integ = html_lib.unescape(get("https://search.naver.com/search.naver?query=" + urllib.parse.quote(keyword)))
    sleep(NAVER_GAP)
    return {"naver_blog_rank": rank, "naver_blog_n": n, "naver_post_matched": matched,
            "naver_integ_blog": OURS in integ, "naver_integ_main": SITE_HOST in integ}


def _svc(ros, api, ver, scopes):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(ros["GA_SERVICE_ACCOUNT_JSON"], scopes=scopes)
    return build(api, ver, credentials=creds, cache_discovery=False)


def gsc_pages(ros, start, end):
    """slug → {impressions, clicks, position, top_queries}."""
    sites = [s.strip() for s in ros.get("SEARCH_CONSOLE_SITES", "").split(",") if SITE_HOST in s]
    if not sites:
        raise RuntimeError("SEARCH_CONSOLE_SITES 에 goodfinance.kr 없음")
    svc = _svc(ros, "searchconsole", "v1", GSC_SCOPE)
    q = lambda dims, n: svc.searchanalytics().query(siteUrl=sites[0], body={  # noqa: E731
        "startDate": str(start), "endDate": str(end), "dimensions": dims, "rowLimit": n}).execute().get("rows", [])
    out = {}
    for r in q(["page"], 1000):
        slug = slug_of(re.sub(r"^https?://[^/]+", "", r["keys"][0]))
        if slug:
            o = out.setdefault(slug, {"impressions": 0, "clicks": 0, "_pos": 0.0, "top_queries": []})
            o["impressions"] += int(r.get("impressions", 0))
            o["clicks"] += int(r.get("clicks", 0))
            o["_pos"] += float(r.get("position", 0)) * int(r.get("impressions", 0))
    for r in q(["page", "query"], 5000):
        slug = slug_of(re.sub(r"^https?://[^/]+", "", r["keys"][0]))
        if slug in out:
            out[slug]["top_queries"].append({"query": r["keys"][1], "impressions": int(r.get("impressions", 0)),
                                             "clicks": int(r.get("clicks", 0)), "position": round(float(r.get("position", 0)), 1)})
    for o in out.values():
        o["position"] = round(o.pop("_pos") / o["impressions"], 2) if o["impressions"] else None
        o["top_queries"] = sorted(o["top_queries"], key=lambda x: (-x["impressions"], -x["clicks"]))[:5]
    return out


def ga4_landing(ros, start, end):
    """slug → {sessions, by_source, conv}. localhost 등 내부 유입원은 뺀다."""
    svc = _svc(ros, "analyticsdata", "v1beta", GA4_SCOPE)
    prop = f"properties/{ros['GA4_PROPERTY_ID_GOODFINANCE']}"
    flt = {"filter": {"fieldName": "landingPage", "stringFilter": {"matchType": "BEGINS_WITH", "value": "/news/"}}}
    rng = [{"startDate": str(start), "endDate": str(end)}]
    rows = svc.properties().runReport(property=prop, body={
        "dateRanges": rng, "dimensions": [{"name": "landingPage"}, {"name": "sessionSource"}],
        "metrics": [{"name": "sessions"}], "dimensionFilter": flt, "limit": 5000}).execute().get("rows", [])
    out = defaultdict(lambda: {"sessions": 0, "by_source": Counter(), "conv": Counter()})
    for r in rows:
        path, src = (d["value"] for d in r["dimensionValues"])
        slug = slug_of(path)
        if not slug or is_internal_source(src):
            continue
        n = int(r["metricValues"][0]["value"])
        out[slug]["sessions"] += n
        out[slug]["by_source"][source_bucket(src)] += n
    ev = svc.properties().runReport(property=prop, body={
        "dateRanges": rng, "dimensions": [{"name": "landingPage"}, {"name": "eventName"}],
        "metrics": [{"name": "eventCount"}], "limit": 5000,
        "dimensionFilter": {"andGroup": {"expressions": [
            flt, {"filter": {"fieldName": "eventName", "inListFilter": {"values": list(CONV_EVENTS)}}}]}}}).execute().get("rows", [])
    for r in ev:
        path, name = (d["value"] for d in r["dimensionValues"])
        slug = slug_of(path)
        if slug:
            out[slug]["conv"][name] += int(r["metricValues"][0]["value"])
    return {k: {"sessions": v["sessions"], "by_source": dict(v["by_source"]), "conv": dict(v["conv"])} for k, v in out.items()}


def measure(env, ros, week, today, only=None, log=print, naver=naver_measure):
    articles = fetch_articles(env)
    errors_all = {}
    try:
        log_nos = fetch_naver_urls(env)
    except Exception as e:
        log_nos, errors_all["naver_url"] = {}, f"{type(e).__name__}: {str(e)[:120]}"
    gs, ge = gsc_window(today)
    gsc = ga = None
    if only != "naver":
        try:
            gsc = gsc_pages(ros, gs, ge)
        except Exception as e:
            errors_all["gsc"] = f"{type(e).__name__}: {str(e)[:120]}"
        try:
            ga = ga4_landing(ros, *week)
        except Exception as e:
            errors_all["ga4"] = f"{type(e).__name__}: {str(e)[:120]}"
    rows = []
    for a in articles:
        row = {"week_start": str(week[0]), "article_id": a["id"], "slug": a["slug"], "errors": dict(errors_all)}
        kw, src = keyword_for(a)
        row["keyword"], row["keyword_source"] = kw, src
        if only != "main" and a.get("is_naver_published") and kw:
            try:
                row.update(naver(kw, log_nos.get(a["id"])))
                row["naver_measured"] = True
            except Exception as e:
                row["errors"]["naver"] = f"{type(e).__name__}: {str(e)[:120]}"
        if only != "naver" and a.get("is_main_published"):
            if gsc is not None:
                g = gsc.get(a["slug"]) or {}
                row.update({"gsc_from": str(gs), "gsc_to": str(ge), "gsc_impressions": g.get("impressions", 0),
                            "gsc_clicks": g.get("clicks", 0), "gsc_position": g.get("position"),
                            "gsc_top_queries": g.get("top_queries", [])})
            if ga is not None:
                x = ga.get(a["slug"]) or {}
                row.update({"ga_sessions": x.get("sessions", 0), "ga_sessions_by_source": x.get("by_source", {}),
                            "conv_events": {k: (x.get("conv") or {}).get(k, 0) for k in CONV_EVENTS}})
        row["verdicts"] = verdicts(row)
        rows.append(row)
        nr = (row["naver_blog_rank"] or "밖") if row.get("naver_measured") else "-"
        log(f"{a['slug'][:48]:<48} 「{kw}」({src}) 블로그탭 {nr} "
            f"· GSC {row.get('gsc_impressions', '-')}/{row.get('gsc_clicks', '-')} · 세션 {row.get('ga_sessions', '-')} "
            f"· {', '.join(row['verdicts']) or '—'}")
    return rows


DB_COLS = ("week_start", "article_id", "slug", "keyword", "keyword_source", "naver_blog_rank", "naver_blog_n",
           "naver_post_matched", "naver_integ_blog", "naver_integ_main", "gsc_from", "gsc_to", "gsc_impressions",
           "gsc_clicks", "gsc_position", "gsc_top_queries", "ga_sessions", "ga_sessions_by_source", "conv_events",
           "verdicts", "errors")


def db_row(row):
    out = {k: row.get(k) for k in DB_COLS}
    out["errors"] = row.get("errors") or None
    out["measured_at"] = datetime.now(timezone.utc).isoformat()
    return out


def save(env, rows):
    url, h = _rest_table(env, "content_index_weekly")
    r = requests.post(url, params={"on_conflict": "week_start,slug"}, json=[db_row(x) for x in rows],
                      headers={**h, "Prefer": "resolution=merge-duplicates,return=minimal"}, timeout=60)
    if r.status_code >= 300:
        raise RuntimeError(f"content_index_weekly 저장 실패 {r.status_code}: {r.text[:200]}")


def send(env, text):
    token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      data={"chat_id": chat, "text": text[:4000], "disable_web_page_preview": "true"}, timeout=30)
    return r.ok and r.json().get("ok", False)


def install():
    import pams_auto   # 같은 인터프리터 규칙(weekly_lead_report 와 동일)
    tr = f'"{pams_auto.pythonw()}" "{os.path.abspath(__file__)}" --save --send'
    r = subprocess.run(["schtasks", "/Create", "/TN", TASK_NAME, "/SC", "WEEKLY", "/D", "MON", "/ST", "08:00",
                        "/TR", tr, "/F"], capture_output=True, text=True)
    print(r.stdout or r.stderr)
    return r.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save", action="store_true", help="content_index_weekly 에 upsert")
    ap.add_argument("--send", action="store_true", help="텔레그램 요약 1통")
    ap.add_argument("--install", action="store_true")
    ap.add_argument("--week-of", help="그 주 월요일(YYYY-MM-DD). 기본 = 지난주")
    ap.add_argument("--only", choices=("naver", "main"))
    ap.add_argument("--env-file", help="SHIN .env.local 경로(기본 = 저장소 루트). 워크트리에서 돌릴 때")
    a = ap.parse_args()
    if a.install:
        sys.exit(install())
    env, ros = kit.load_env(), load_ros_env()
    if a.env_file:
        env = {**load_ros_env(a.env_file), **env}
    today = datetime.now(KST).date()
    if a.week_of:
        mon = date.fromisoformat(a.week_of)
        week = (mon, mon + timedelta(days=6))
    else:
        week, _ = last_week(today)
    rows = measure(env, ros, week, today, only=a.only)
    prev = fetch_prev(env, week[0])
    labels = kit_labels(env)
    text = compose(week, rows, prev, labels)
    print("\n" + text)
    if a.save:
        save(env, rows)
        print(f"저장: {len(rows)}행 (week_start={week[0]})")
    if a.send:
        print("발송:", "완료" if send(env, text) else "실패")


def kit_labels(env):
    try:
        url, h = kit._rest(env)
        rows = requests.get(url, params={"select": "slug,title"}, headers=h, timeout=30).json()
        return {r["slug"]: kit.title_label(r.get("title"), r["slug"]) for r in rows}
    except Exception:
        return {}


if __name__ == "__main__":
    main()
