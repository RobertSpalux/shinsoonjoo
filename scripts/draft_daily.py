#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
매일 원고 공급 — 작업 스케줄러 SHIN_draft_daily 가 매일 06:30 에 한 번 돌린다(SUP1, 2026-10-20).

    python scripts/draft_daily.py                 # 1편: 생성 → 게이트 → DB 초안 투입 → 네이버 비공개 파일 → Soonjoo_PB 1줄
    python scripts/draft_daily.py --no-send       # 텔레그램 없이
    python scripts/draft_daily.py --install       # 작업 스케줄러 등록(매일 06:30, pythonw)

왜: premium_articles 새 원고가 10/15 이후 0편이었다. draft_weekly 는 10/12 1회만 돌았고 정기 실행이 없었다.
    심의 슬롯은 3칸·하루 내외 승인 → 주 3편 공급으로는 슬롯이 빈다. 네이버 글은 ~3주면 30위 밖(IX1) → 발행 빈도가 지수의 핵심.

순서(한 편):
  ① 주제 = configs/draft_topics.json 위에서부터 안 쓴 것(수요 근거 주제가 맨 위) — draft_weekly 와 같은 판정
  ② draft_weekly.generate_one — `claude -p`(구독). API 키가 환경에 보이면 생성하지 않는다(유료 청구 차단)
  ③ 반려(게이트) · 생성 실패 · [확인: ___] 남은 원고 → **다음 주제로 1회만 다시**. 둘 다 안 되면 그 사실을 1줄로 알린다
  ④ 통과 → draft_insert 와 같은 검사(네이버 규칙 10 · topic_guard) 뒤 premium_articles 에 초안 저장(needs_human_review=true)
  ⑤ 사진 5장: 원고의 naver_images 설정 → 초안 폴더 images\\ 에 렌더(금액·금소법 표현·칸 넘침이면 사진 없이 진행)
  ⑥ 네이버 비공개 파일: naver_private_guide.build — Downloads\\PAMS접수\\_네이버비공개\\ (로버트 규칙: 이 폴더 외 안내 금지)
  ⑦ Soonjoo_PB(TELEGRAM_CHAT_ID) 1줄: 「오늘 원고: 제목 · 네이버 파일 위치」

🔴 저장소(main 작업 트리)의 추적 파일을 고치지 않는다 — 크론이 main 트리에서 돈다.
   · 네이버 키워드는 configs/naver_keywords.json 대신 <초안 폴더>\\_keywords_pending.json 에 모은다
     (preflight 는 미등록 키워드를 실패가 아니라 메모로 넘긴다 — 접수 전 커밋 PR 로 옮긴다).
   · 사진 설정·PNG 도 저장소 configs\\ · assets\\ 가 아니라 초안 폴더에 둔다(머지 때 untracked 충돌 방지).
하지 않는 것: PAMS 제출 · 네이버 게시 · 승인된 글 수정 · ad_reviews 쓰기.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import traceback
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import draft_insert as di  # noqa: E402
import draft_weekly as dw  # noqa: E402
import pams_kit as kit  # noqa: E402

TASK_NAME = "SHIN_draft_daily"
TRIES = 2                     # 첫 주제 + 다음 주제로 1회 재시도
PORT = 3946
LOG_NAME = "_daily.log"
PENDING_KW = "_keywords_pending.json"


def log(out_dir, msg):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    try:
        with open(os.path.join(out_dir, LOG_NAME), "a", encoding="utf-8", newline="\n") as fp:
            fp.write(line + "\n")
    except OSError:
        pass


# ── 순수 함수(시험 대상) ──────────────────────────────────────
def ready(result):
    """투입해도 되는 원고인가 — 게이트 통과 + [확인: ___] 0 + 미실행 게이트 0."""
    return bool(result and result.get("pass") and not result.get("placeholders") and not result.get("unrun"))


def next_topics(cfg, used, tries=TRIES):
    return dw.pick_topics(cfg, used, tries)


def message(ok, title=None, base=None, n_images=0, reasons=()):
    if ok:
        where = f"Downloads\\PAMS접수\\_네이버비공개\\{base}.txt" if base else "네이버 파일 생성 실패 — 로그 확인"
        tail = "" if n_images else " (사진 없음)"
        return f"오늘 원고: {title} · 네이버 파일: {where}{tail}"
    return "오늘 원고 없음 — " + " / ".join(reasons)[:600]


def add_pending_keyword(path, slug, kw):
    data = {}
    if os.path.exists(path):
        try:
            data = json.load(open(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
    data[slug] = kw
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    os.replace(tmp, path)


# ── 단계 ────────────────────────────────────────────────────
def insert(env, d):
    """draft_insert 와 같은 검사 → 저장. 키워드 장부는 저장소가 아니라 초안 폴더 쪽에 적는다. → (DB 행, 키워드)."""
    import requests
    meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
    row = di.build_row(meta, open(os.path.join(d, "main.md"), encoding="utf-8").read(),
                       open(os.path.join(d, "naver.txt"), encoding="utf-8").read())
    _, new_kw = di.naver_gate(row, meta_kw=meta.get("naver_keyword"))
    di.topic_guard.guard(env, {"slug": row["slug"], "title": row["title"], "naver_title": row["naver_title"]})
    url, h = kit._rest(env)
    r = requests.post(url, json=row, headers={**h, "Prefer": "return=representation"}, timeout=30)
    if not r.ok:
        raise kit.KitError(f"DB 저장 실패 {r.status_code}: {r.text[:200]}")
    return r.json()[0], (new_kw or meta.get("naver_keyword"))


def render_images(d, slug):
    """초안 폴더 naver_images.json → images\\<slug>-N-*.png 5장. 막히면 (0, 사유)."""
    p = os.path.join(d, "naver_images.json")
    if not os.path.exists(p):
        return 0, "사진 설정 없음"
    cfg = json.load(open(p, encoding="utf-8"))
    bad = dw.image_issues(cfg)
    if bad:
        return 0, " · ".join(bad)
    # 예약 작업 환경엔 NAVER_FONT_DIR 가 없다 — 이 PC 의 Noto CJK 6종 위치(렌더러가 import 때 읽는다)
    os.environ.setdefault("NAVER_FONT_DIR", os.path.join(os.environ.get("LOCALAPPDATA", ""), "SHIN", "fonts"))
    sys.path.insert(0, kit.ROOT)
    try:
        import naver_images as ni
        import naver_images_more as nm
        ni.check_fonts()
        out = os.path.join(d, "images")
        os.makedirs(out, exist_ok=True)
        jobs = [("1-thumb", ni.render_thumbnail), ("2-table", ni.render_table), ("3-contrast", nm.render_contrast),
                ("4-flow", nm.render_flow), ("5-points-cta", ni.render_points_cta)]
        for name, fn in jobs:
            fn(cfg).save(os.path.join(out, f"{slug}-{name}.png"), "PNG", optimize=True)
        return len(jobs), ""
    except SystemExit as e:          # 칸 넘침 · 폰트 없음 — 렌더러가 SystemExit 로 알린다
        shutil.rmtree(os.path.join(d, "images"), ignore_errors=True)
        return 0, f"사진 렌더 실패: {e}"


def naver_file(env, slug, d):
    """naver_private_guide.build — 사진만 초안 폴더 images\\ 에서 읽는다(저장소 assets 를 쓰지 않는다)."""
    import naver_private_guide as g
    import publish_approved as pa
    img_dir = os.path.join(d, "images")

    def copy_images(_slug, out_dir, base):
        names = sorted(n for n in os.listdir(img_dir) if n.lower().endswith(".png")) if os.path.isdir(img_dir) else []
        out = []
        for i, n in enumerate(names, 1):
            dst = f"{base}_이미지{i}.png"
            shutil.copyfile(os.path.join(img_dir, n), os.path.join(out_dir, dst))
            out.append(dst)
        return out

    pa.copy_images = copy_images
    art = kit.fetch_article(env, slug)
    with kit.LocalServer(port=PORT, log=lambda m: None) as srv:
        res = g.build(env, art, srv)
    return res


def send(env, text):
    import requests
    token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      data={"chat_id": chat, "text": text[:4000], "disable_web_page_preview": "true"}, timeout=30)
    return r.ok and r.json().get("ok", False)


def run(out_dir=dw.OUT_DIR, do_send=True):
    env = kit.load_env()
    cfg = dw.load_topics()
    rules_text = open(dw.RULES_MD, encoding="utf-8").read() if os.path.exists(dw.RULES_MD) else ""
    if not rules_text:
        msg = message(False, reasons=[f"규칙 파일 없음 {dw.RULES_MD}"])
        log(out_dir, msg)
        if do_send:
            send(env, msg)
        return 1
    reasons, tried = [], set()
    for _ in range(TRIES):
        topics = [t for t in dw.pick_topics(cfg, dw.used_slugs(out_dir) | tried, 1)]
        if not topics:
            reasons.append("대기열 소진 — configs/draft_topics.json 에 주제를 더한다")
            break
        t = topics[0]
        tried.add(t["slug"])
        log(out_dir, f"주제 {t['slug']} ({t['keyword']})")
        d, draft, result = dw.generate_one(t, cfg, out_dir, env, rules_text)
        if d is None:
            reasons.append(f"{t['slug']} 생성 실패: {str(result)[:120]}")
            continue
        if not ready(result):
            bad = [s["name"] for s in result["stages"] if not s["pass"]]
            why = (("반려 " + ", ".join(bad)) if bad else "") + (f" 확인 필요 {len(result['placeholders'])}건" if result.get("placeholders") else "")
            reasons.append(f"{t['slug']} {why.strip()}")
            log(out_dir, f"  → 투입 안 함: {why.strip()} ({d})")
            continue
        try:
            row, kw = insert(env, d)
        except kit.KitError as e:
            reasons.append(f"{t['slug']} 투입 막힘: {str(e)[:160]}")
            log(out_dir, f"  → 투입 막힘: {e}")
            continue
        add_pending_keyword(os.path.join(out_dir, PENDING_KW), row["slug"], kw)
        log(out_dir, f"  → DB 초안 {row['id']} · 키워드 「{kw}」(장부 대기 {PENDING_KW})")
        n, why = render_images(d, row["slug"])
        log(out_dir, f"  → 사진 {n}장" + (f" ({why})" if why else ""))
        base = None
        try:
            res = naver_file(env, row["slug"], d)
            base = os.path.splitext(os.path.basename(res["txt"]))[0]
            log(out_dir, f"  → 네이버 파일 {res['txt']}")
        except Exception as e:   # 네이버 파일이 막혀도 투입은 끝났다 — 알림에 적는다
            log(out_dir, f"  → 네이버 파일 실패: {type(e).__name__}: {str(e)[:200]}")
        msg = message(True, row.get("naver_title") or row.get("title"), base, n)
        log(out_dir, msg)
        if do_send:
            log(out_dir, "  발송 " + ("완료" if send(env, msg) else "실패"))
        return 0
    msg = message(False, reasons=reasons or ["알 수 없음"])
    log(out_dir, msg)
    if do_send:
        send(env, msg)
    return 1


def install():
    import pams_auto   # 같은 인터프리터 규칙(weekly_lead_report · content_index_weekly 와 동일)
    tr = f'"{pams_auto.pythonw()}" "{os.path.abspath(__file__)}"'
    r = subprocess.run(["schtasks", "/Create", "/TN", TASK_NAME, "/SC", "DAILY", "/ST", "06:30", "/TR", tr, "/F"],
                       capture_output=True, text=True)
    print(r.stdout or r.stderr)
    return r.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-send", action="store_true")
    ap.add_argument("--install", action="store_true")
    ap.add_argument("--out", default=dw.OUT_DIR)
    a = ap.parse_args()
    if a.install:
        sys.exit(install())
    os.makedirs(a.out, exist_ok=True)
    try:
        sys.exit(run(a.out, do_send=not a.no_send))
    except Exception as e:
        log(a.out, f"중단: {type(e).__name__}: {e}\n{traceback.format_exc()[-800:]}")
        if not a.no_send:
            try:
                send(kit.load_env(), message(False, reasons=[f"공급기 중단 {type(e).__name__}: {str(e)[:200]}"]))
            except Exception:
                pass
        sys.exit(1)


if __name__ == "__main__":
    main()
