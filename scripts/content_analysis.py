#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
선한금융 콘텐츠 성과 분석 — 「어떤 글이 상담을 만들었나」. **읽기 전용**(DB 쓰기·발송 없음).

    py -3.14 -X utf8 scripts/content_analysis.py                       # 2026-07-20 ~ 어제
    py -3.14 -X utf8 scripts/content_analysis.py --from 2026-09-01 --to 2026-09-30

지표 = 상담 성사(진단 완료 · 카카오 대화창 열기). 조회수·노출은 보조.
조회 함수는 weekly_lead_report 를 import 해 재사용(GA4·GSC·ad_reviews 자격증명 동일, 값은 출력하지 않는다).
출력: D:\\robert-os\\tmp\\relay\\goodfinance_content_analysis.json + 표 텍스트(stdout)
"""
import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import weekly_lead_report as w  # noqa: E402
import pams_kit as kit  # noqa: E402

DEFAULT_FROM = date(2026, 7, 20)
OUT_JSON = os.environ.get("CONTENT_ANALYSIS_OUT", r"D:\robert-os\tmp\relay\goodfinance_content_analysis.json")
EVENTS = ("diagnosis_start", "diagnosis_complete", "kakao_cta_click")
SOURCES = ("네이버 블로그", "스레드", "검색", "기타")   # w.source_bucket 의 반환값 (검색 = 구글 등 organic)
CH_LABEL = {"main": "본진", "naver": "네이버", "threads": "스레드", "instagram": "인스타", "blogspot": "블로그스팟"}


# ── 순수 함수 ────────────────────────────────────────────────
def norm_path(p):
    """landingPage/URL → 쿼리·프래그먼트·말미 슬래시 제거한 경로. 비면 '/'."""
    p = re.sub(r"^https?://[^/]+", "", p or "")
    p = re.split(r"[?#]", p)[0]
    return (p.rstrip("/") or "/")


def ctr(clicks, imps):
    return f"{clicks * 100 / imps:.1f}%" if imps else "—"


def merge_sources(rows):
    """[(path, source, medium, sessions)] → {path: Counter(버킷 → 세션, 합계)}"""
    out = defaultdict(Counter)
    for path, src, med, n in rows:
        p = norm_path(path)
        out[p][w.source_bucket(src, med)] += n
        out[p]["합계"] += n
    return out


def merge_events(rows):
    """[(path, event, count)] → {path: Counter(event → count)}"""
    out = defaultdict(Counter)
    for path, ev, n in rows:
        out[norm_path(path)][ev] += n
    return out


def merge_gsc(rows):
    """[(page_url, clicks, impressions, position)] → {path: dict}. 같은 경로가 여럿이면 노출 가중 평균 순위."""
    acc = {}
    for page, c, i, pos in rows:
        p = norm_path(page)
        a = acc.setdefault(p, {"clicks": 0, "imps": 0, "pos_w": 0.0})
        a["clicks"] += c
        a["imps"] += i
        a["pos_w"] += pos * i
    return {p: {"clicks": a["clicks"], "imps": a["imps"], "pos": round(a["pos_w"] / a["imps"], 1) if a["imps"] else None}
            for p, a in acc.items()}


def funnel_rate(n_from, n_to):
    return f"{n_to * 100 / n_from:.0f}%" if n_from else "—"


def article_lines(reviews, titles, src, ev, gsc):
    """승인·게시 ad_reviews 행 → 글별 한 줄 dict 목록(호수 순). 사이트 지표는 slug 의 /news 경로 기준.
    본진 행은 전 유입원, 그 외 채널 행은 해당 채널 유입원 세션만 따로 붙인다."""
    lines = []
    for r in reviews:
        if r.get("status") != "approved" or not r.get("posted_url"):
            continue
        slug = (titles.get(r.get("article_id")) or {}).get("slug")
        path = f"/news/{slug}" if slug else None
        s, e, g = src.get(path, Counter()), ev.get(path, Counter()), gsc.get(path, {})
        ch = r.get("channel")
        lines.append({
            "issue": (titles.get(r.get("article_id")) or {}).get("issue"),
            "slug": slug,
            "title": (titles.get(r.get("article_id")) or {}).get("title"),
            "channel": CH_LABEL.get(ch, ch),
            "posted": (r.get("url_registered_at") or r.get("reviewed_at") or r.get("review_from") or "")[:10],
            "posted_url": r.get("posted_url"),
            "sessions_total": s.get("합계", 0) if ch == "main" else None,
            "sessions_by_source": {k: s.get(k, 0) for k in SOURCES} if ch == "main" else None,
            "sessions_from_this_channel": ({"네이버": s.get("네이버 블로그", 0), "스레드": s.get("스레드", 0)}.get(CH_LABEL.get(ch))
                                           if ch in ("naver", "threads") else None),
            "gsc_imps": g.get("imps", 0) if ch == "main" else None,
            "gsc_clicks": g.get("clicks", 0) if ch == "main" else None,
            "gsc_pos": g.get("pos") if ch == "main" else None,
            "diag_start": e.get("diagnosis_start", 0) if ch == "main" else None,
            "diag_complete": e.get("diagnosis_complete", 0) if ch == "main" else None,
            "kakao_click": e.get("kakao_cta_click", 0) if ch == "main" else None,
        })
    lines.sort(key=lambda x: (x["issue"] is None, x["issue"] or 0, x["channel"]))
    return lines


def no_click_articles(lines, min_imps=20):
    """노출은 있는데 클릭 0 (제목 문제 후보). 본진 행만."""
    return [l for l in lines if l["channel"] == "본진" and (l["gsc_imps"] or 0) >= min_imps and not l["gsc_clicks"]]


def consult_makers(lines):
    """카카오 클릭 또는 진단 완료가 1 이상인 본진 글, 많은 순."""
    got = [l for l in lines if l["channel"] == "본진" and ((l["kakao_click"] or 0) or (l["diag_complete"] or 0))]
    return sorted(got, key=lambda l: (-(l["kakao_click"] or 0), -(l["diag_complete"] or 0)))


def top_pages(src, n=10):
    return sorted(((p, c.get("합계", 0)) for p, c in src.items()), key=lambda kv: -kv[1])[:n]


def source_totals(src):
    tot = Counter()
    for c in src.values():
        for k in SOURCES:
            tot[k] += c.get(k, 0)
    tot["합계"] = sum(tot[k] for k in SOURCES)
    return {k: tot.get(k, 0) for k in (*SOURCES, "합계")}


def fmt_n(v):
    return "·" if v is None else str(v)


def render(period, lines, tops, totals, funnel, notes):
    s, e = period
    L = [f"[선한금융 콘텐츠 성과] {s} ~ {e}", ""]
    L.append("① 글별 (승인·게시)  ※ ·=해당 채널 행엔 사이트 지표 없음 / 네이버·스레드 행은 그 채널발 본진 세션")
    L.append("호 | 제목 | 채널 | 게시일 | 세션(네이버/스레드/검색/기타) | GSC 노출/클릭/순위 | 시작/완료/카톡")
    for l in lines:
        sb = l["sessions_by_source"]
        sess = (f"{l['sessions_total']} ({sb['네이버 블로그']}/{sb['스레드']}/{sb['검색']}/{sb['기타']})"
                if sb else (f"채널발 {l['sessions_from_this_channel']}" if l["sessions_from_this_channel"] is not None else "·"))
        gsc = f"{l['gsc_imps']}/{l['gsc_clicks']}/{l['gsc_pos'] if l['gsc_pos'] is not None else '—'}" if l["gsc_imps"] is not None else "·"
        fn = f"{fmt_n(l['diag_start'])}/{fmt_n(l['diag_complete'])}/{fmt_n(l['kakao_click'])}"
        L.append(f"{l['issue'] or '?'}호 | {(l['title'] or '')[:30]} | {l['channel']} | {l['posted']} | {sess} | {gsc} | {fn}")
    L += ["", "② 착지별 상위 10 (세션)"]
    L += [f"  {p}  {n}" for p, n in tops] or ["  데이터 없음"]
    L += ["", "③ 유입원 합계 (/news 착지 아닌 전체 착지 포함)"]
    L.append("  " + " · ".join(f"{k} {v}" for k, v in totals.items()))
    L += ["", "④ 퍼널"]
    if funnel is None:
        L.append("  조회 실패(GA4)")
    else:
        L.append(f"  시작 {funnel['diagnosis_start']} → 완료 {funnel['diagnosis_complete']} ({funnel_rate(funnel['diagnosis_start'], funnel['diagnosis_complete'])})"
                 f" → 카톡(결과화면) {funnel['kakao_cta_click']} ({funnel_rate(funnel['diagnosis_complete'], funnel['kakao_cta_click'])})")
    if notes:
        L += ["", "※ " + " / ".join(notes)]
    return "\n".join(L)


# ── 조회 (읽기 전용) ─────────────────────────────────────────
def ga4_landing_sources(ros, start, end):
    svc = w._svc(ros, "analyticsdata", "v1beta", w.GA4_SCOPE)
    rows = svc.properties().runReport(property=f"properties/{ros['GA4_PROPERTY_ID_GOODFINANCE']}", body={
        "dateRanges": [{"startDate": str(start), "endDate": str(end)}],
        "dimensions": [{"name": "landingPage"}, {"name": "sessionSource"}, {"name": "sessionMedium"}],
        "metrics": [{"name": "sessions"}], "limit": 10000}).execute().get("rows", [])
    return [(*[d["value"] for d in r["dimensionValues"]], int(r["metricValues"][0]["value"])) for r in rows]


def ga4_landing_events(ros, start, end):
    """이벤트를 세션의 착지 페이지별로(landingPage 는 세션 범위 측정기준이라 이벤트와 함께 조회 가능)."""
    svc = w._svc(ros, "analyticsdata", "v1beta", w.GA4_SCOPE)
    rows = svc.properties().runReport(property=f"properties/{ros['GA4_PROPERTY_ID_GOODFINANCE']}", body={
        "dateRanges": [{"startDate": str(start), "endDate": str(end)}],
        "dimensions": [{"name": "landingPage"}, {"name": "eventName"}],
        "metrics": [{"name": "eventCount"}],
        "dimensionFilter": {"filter": {"fieldName": "eventName", "inListFilter": {"values": list(EVENTS)}}},
        "limit": 10000}).execute().get("rows", [])
    return [(r["dimensionValues"][0]["value"], r["dimensionValues"][1]["value"], int(r["metricValues"][0]["value"])) for r in rows]


def gsc_pages(ros, start, end):
    sites = [s.strip() for s in ros.get("SEARCH_CONSOLE_SITES", "").split(",") if w.SITE_HOST in s]
    if not sites:
        return []
    svc = w._svc(ros, "searchconsole", "v1", w.GSC_SCOPE)
    rows = svc.searchanalytics().query(siteUrl=sites[0], body={
        "startDate": str(start), "endDate": str(end), "dimensions": ["page"], "rowLimit": 1000}).execute().get("rows", [])
    return [(r["keys"][0], int(r.get("clicks", 0)), int(r.get("impressions", 0)), float(r.get("position", 0))) for r in rows]


def db_reviews_and_titles(env):
    url, h = kit._rest(env)
    base = url.rsplit("/", 1)[0]
    rv = requests.get(f"{base}/ad_reviews", params={
        "select": "article_id,channel,status,review_no,review_from,reviewed_at,posted_url,url_registered_at"}, headers=h, timeout=30).json()
    ar = requests.get(url, params={"select": "id,slug,title"}, headers=h, timeout=30).json()
    titles = {}
    for a in ar:
        head = re.split(r"\s+[—–-]\s+", (a.get("title") or "").strip())[0].strip()
        iss = kit.issue_label(a["slug"])
        titles[a["id"]] = {"slug": a["slug"], "title": head, "issue": int(iss[:-1]) if iss.endswith("호") and iss[:-1].isdigit() else None}
    return rv, titles


def safe(label, fn, notes, default):
    try:
        return fn()
    except Exception as e:
        notes.append(f"{label} 조회 실패: {type(e).__name__}: {str(e)[:100]}")
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", help="YYYY-MM-DD (기본 2026-07-20)")
    ap.add_argument("--to", dest="end", help="YYYY-MM-DD (기본 어제)")
    a = ap.parse_args()
    start = date.fromisoformat(a.start) if a.start else DEFAULT_FROM
    end = date.fromisoformat(a.end) if a.end else date.today() - timedelta(days=1)
    env, ros = kit.load_env(), w.load_ros_env()
    notes = []
    rv, titles = safe("DB", lambda: db_reviews_and_titles(env), notes, ([], {}))
    src = merge_sources(safe("GA4 유입", lambda: ga4_landing_sources(ros, start, end), notes, []))
    ev = merge_events(safe("GA4 이벤트", lambda: ga4_landing_events(ros, start, end), notes, []))
    gsc = merge_gsc(safe("GSC", lambda: gsc_pages(ros, start, end), notes, []))
    funnel = safe("GA4 퍼널", lambda: w.ga4_funnel(ros, start, end), notes, None)
    lines = article_lines(rv, titles, src, ev, gsc)
    tops, totals = top_pages(src), source_totals(src)
    print(render((start, end), lines, tops, totals, funnel, notes))
    out = {"period": [str(start), str(end)], "generated": datetime.now().isoformat(timespec="seconds"),
           "articles": lines, "top_pages": tops, "source_totals": totals, "funnel": funnel,
           "events_all_landings": {p: dict(c) for p, c in ev.items()},
           "gsc_all_pages": gsc, "no_click": [l["slug"] for l in no_click_articles(lines)],
           "consult_makers": [l["slug"] for l in consult_makers(lines)], "notes": notes}
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1)
    print(f"\n→ {OUT_JSON}")


if __name__ == "__main__":
    main()
