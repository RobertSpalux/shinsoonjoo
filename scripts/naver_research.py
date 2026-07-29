# -*- coding: utf-8 -*-
"""
naver_research.py — 네이버 검색 API 주제 발굴 수집기 (1차 · 탐색용)

목적: TOPIC-BANK [1] 주제 발굴 부품의 자동화. 수동 검색을 대체한다.
  - 블로그: 경쟁이 무엇을 쓰는가 (수요 검증)
  - 지식iN: 사람들이 무엇을 모르는가 (질문 원천)
  - 카페  : 실제 고민 맥락

⚠️ 수집물은 §9상 '주제 발굴 소스'일 뿐 근거가 아니다.
   본문 근거는 금융위·금감원 원문으로만 쓴다.

API: NAVER API HUB (NCP 경유)
  https://naverapihub.apigw.ntruss.com/search/v1/{blog|kin|cafe}
  헤더 X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY
  한도: 검색 통합 월 775,000건 (일 약 25,000) · 50 RPS

실행:  python scripts/naver_research.py
출력:  data/naver_research_YYYYMMDD.json  +  콘솔 요약
"""
import os
import re
import sys
import json
import time
import html
import urllib.parse
import urllib.request
from datetime import datetime
from collections import Counter

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

BASE = "https://naverapihub.apigw.ntruss.com/search/v1"
# ⚠️ 카페는 엔드포인트명이 cafearticle (2026-07-29 실측: /cafe → 404 errorCode 300)
TYPES = ["blog", "kin", "cafearticle"]
DISPLAY = 30          # 요청당 결과 수 (최대 100)
SLEEP = 0.15          # 50 RPS 여유

# ── 시드 키워드 ────────────────────────────────────────────
# 우리 클러스터 4종 기준. 여기를 늘리면 수집 범위가 넓어진다.
SEEDS = {
    "A_실손전환": [
        "실손 1세대", "실손보험 재매입", "단체실손 개인실손",
        "실손보험 갈아타기", "5세대 실손 전환",
    ],
    "B_가입고지": [
        "간편심사보험 고지의무", "부담보 해제", "고지의무 위반",
        "유병자보험 가입", "건강검진 재검사 보험",
    ],
    "C_배상책임": [
        "일상생활배상책임", "누수 배상책임보험",
        "영업배상책임보험", "화재배상책임보험 의무",
    ],
    "D_간병": [
        "간병인보험 지원형 사용형", "가족간병보험", "간병비보험",
    ],
}


def load_env():
    """저장소 루트의 .env / .env.local 에서 키를 읽는다."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for name in (".env.local", ".env"):
        path = os.path.join(root, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    cid = os.environ.get("NAVER_CLIENT_ID", "")
    sec = os.environ.get("NAVER_CLIENT_SECRET", "")
    if not cid or not sec:
        sys.exit("[중단] NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 비어 있습니다. "
                 ".env 또는 .env.local 을 확인하세요.")
    return cid, sec


def clean(s):
    """API가 돌려주는 <b> 태그와 HTML 엔티티를 제거."""
    return html.unescape(re.sub(r"</?b>", "", s or "")).strip()


def search(kind, query, cid, sec, display=DISPLAY, sort="date"):
    url = f"{BASE}/{kind}?" + urllib.parse.urlencode(
        {"query": query, "display": display, "start": 1, "sort": sort, "format": "json"}
    )
    req = urllib.request.Request(url, headers={
        "X-NCP-APIGW-API-KEY-ID": cid,
        "X-NCP-APIGW-API-KEY": sec,
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")
        print(f"  [HTTP {e.code}] {kind}/{query} → {body[:200]}")
        return None
    except Exception as e:
        print(f"  [ERR] {kind}/{query} → {e}")
        return None


def main():
    cid, sec = load_env()
    out = {"collected_at": datetime.now().isoformat(), "clusters": {}}
    calls = 0

    for cluster, keywords in SEEDS.items():
        print(f"\n{'='*60}\n{cluster}\n{'='*60}")
        out["clusters"][cluster] = {}

        for kw in keywords:
            out["clusters"][cluster][kw] = {}
            print(f"\n▶ {kw}")

            for kind in TYPES:
                res = search(kind, kw, cid, sec)
                calls += 1
                time.sleep(SLEEP)
                if not res:
                    continue

                items = []
                for it in res.get("items", []):
                    items.append({
                        "title": clean(it.get("title")),
                        "desc": clean(it.get("description"))[:200],
                        "link": it.get("link"),
                        "date": it.get("postdate") or it.get("cafename") or "",
                        "author": it.get("bloggername") or it.get("cafename") or "",
                    })
                out["clusters"][cluster][kw][kind] = {
                    "total": res.get("total", 0),
                    "items": items,
                }
                print(f"  {kind:5s} total={res.get('total', 0):>9,}  수집={len(items)}")

    # ── 저장 ──
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    d = os.path.join(root, "data")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"naver_research_{datetime.now():%Y%m%d_%H%M}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # ── 요약: total 기준 수요 순위 ──
    print(f"\n{'='*60}\n수요 순위 (블로그 문서 수 = 경쟁/관심 크기)\n{'='*60}")
    rank = []
    for cluster, kws in out["clusters"].items():
        for kw, kinds in kws.items():
            b = kinds.get("blog", {}).get("total", 0)
            k = kinds.get("kin", {}).get("total", 0)
            rank.append((b, k, cluster, kw))
    for b, k, cluster, kw in sorted(rank, reverse=True):
        print(f"  블로그 {b:>9,} | 지식iN {k:>8,} | {cluster:12s} {kw}")

    print(f"\n호출 {calls}건 / 저장 → {path}")


if __name__ == "__main__":
    main()
