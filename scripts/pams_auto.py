#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 키트 자동 생성 — Windows 작업 스케줄러가 10분마다 한 번 돌린다.

    python scripts/pams_auto.py            # 한 바퀴
    python scripts/pams_auto.py --install  # 작업 스케줄러 등록(10분 주기, 창 없음)
    python scripts/pams_auto.py --uninstall

한 바퀴에서 하는 일
  1. 본진: 발행 플래그(is_main_published)가 false 이고 본진이 아직 접수·승인 전인 글 → 본진 키트.
     · 이미 만든 키트는 다시 만들지 않는다 — 키트 파일이 있고 **원고 해시**가 같으면 건너뛴다.
     · 원고가 바뀌면(해시 변경) 다시 만들고 옛 키트는 지운다(옛 원고로 접수하는 사고 방지).
  2. 네이버: Downloads\\PAMS접수\\ 에 로버트가 넣은 캡처(png/jpg/pdf) → 짝을 맞춰 네이버 키트.
     · 짝: 파일명에 slug·「N호」·네이버 제목 조각이 있으면 그 글. 없으면 네이버 대기 글이 **딱 1편**일 때 그 글.
     · 애매하면(후보 0편·2편 이상) 만들지 않고 텔레그램으로 한 번 묻는다. 파일명에 「7호」처럼 넣으면 다음 바퀴에 짝이 맞는다.
     · 키트가 되면 캡처는 PAMS접수\\캡처_처리됨\\ 로 옮긴다.
  3. 키트가 생기면 텔레그램 1통 — 「0929_7호_본진.zip 준비됨 — PAMS 게시명: … / 자료명: …」

🔴 게이트 — 컴플라이언스 확인이 안 끝난 글은 건너뛴다(우회 없음). 판정은 pams_kit 의 /preview 서버 게이트.
   같은 원고·같은 확인 이력으로 막힌 글은 서버를 다시 띄우지 않는다(10분마다 next dev 를 띄우지 않게).
   어드민에서 확인하면 compliance_acks 가 바뀌어 다음 바퀴에 다시 시도한다.

상태: %LOCALAPPDATA%\\SHIN\\pams_auto_state.json · 로그: 같은 폴더 pams_auto.log
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pams_kit as kit  # noqa: E402

STATE_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "SHIN")
STATE_PATH = os.path.join(STATE_DIR, "pams_auto_state.json")
LOG_PATH = os.path.join(STATE_DIR, "pams_auto.log")
LOCK_PATH = os.path.join(STATE_DIR, "pams_auto.lock")
TASK_NAME = "SHIN_PAMS_KIT"
CAPTURE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".pdf")
DONE_DIR_NAME = "캡처_처리됨"


# ── 공통 ────────────────────────────────────────────────────
def log(msg):
    os.makedirs(STATE_DIR, exist_ok=True)
    if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 1_000_000:
        os.replace(LOG_PATH, LOG_PATH + ".1")
    line = f"{datetime.now(kit.KST):%Y-%m-%d %H:%M:%S} {msg}"
    with open(LOG_PATH, "a", encoding="utf-8") as fp:
        fp.write(line + "\n")
    try:
        print(line)
    except Exception:
        pass


def load_state():
    try:
        return json.load(open(STATE_PATH, encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"kits": {}, "gate_blocked": {}, "captures": {}}


def save_state(state):
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    json.dump(state, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_PATH)


def tg_line(text):
    """발송 기록용 첫 줄 — 한 줄 70자. (2026-10-01 로버트 「제대로 들어오는 거니?」 — 보낸 기록이 없어 답할 수 없었다)"""
    return ((text or "").strip().split("\n", 1)[0])[:70]


def telegram(env, text):
    """Soonjoo_PB 방으로 한 통. **보낼 때마다 결과를 로그에 한 줄 남긴다**(보냄/실패 + 첫 줄).
    🔴 예외 문구는 찍지 않는다 — requests 예외에는 토큰이 든 URL 이 그대로 들어 있다(robert-os notify.py 지적)."""
    token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        log(f"텔레그램 설정 없음 — 알림 생략 · {tg_line(text)}")
        return False
    try:
        r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                          data={"chat_id": chat, "text": text, "disable_web_page_preview": "true"}, timeout=30)
        ok = bool(r.ok and r.json().get("ok", False))
    except (requests.RequestException, ValueError) as e:
        log(f"텔레그램 실패({type(e).__name__}) · {tg_line(text)}")
        return False
    log(f"텔레그램 {'보냄' if ok else f'실패(HTTP {r.status_code})'} · {tg_line(text)}")
    return ok


def alert_once(env, state, key, text, notify=None):
    """같은 문제를 하루 한 번만 알린다(설정 파일 깨짐처럼 바퀴마다 되풀이되는 실패). 알렸으면 True."""
    day = datetime.now(kit.KST).date().isoformat()
    seen = state.setdefault("alerted", {})
    if seen.get(key) == day:
        return False
    (notify or (lambda t: telegram(env, t)))(text)
    seen[key] = day
    return True


def gate_key(article, channel):
    """게이트 재시도 판정 키 — 원고 해시 + 확인 이력. 둘 다 같으면 결과도 같다."""
    acks = json.dumps(article.get("compliance_acks") or [], ensure_ascii=False, sort_keys=True)
    return kit.content_hash(article, channel) + ":" + hashlib.sha256(acks.encode("utf-8")).hexdigest()[:16]


def ready_message(k):
    # 글 제목이 앞, 호수는 괄호(키트 파일명은 그대로 뒤에).
    who = kit.title_label(k.get("article_title") or k.get("title"), k["slug"]) if k.get("slug") else k["title"]
    ch = f" {kit.CH_LABEL[k['channel']]}" if k.get("channel") else ""
    return f"{who}{ch} 키트 준비됨 — {k['name']} · PAMS 게시명: {k['title']} / 자료명: {'; '.join(k['sources'])}"


# ── 판정(순수 함수 — 테스트 대상) ─────────────────────────────
def needs_main_kit(article, state, file_exists=os.path.exists, is_stale=kit.kit_is_stale):
    """본진 키트를 (다시) 만들어야 하는가 → (bool, 사유)."""
    if article.get("is_main_published"):
        return False, "발행됨"
    if kit.channel_locked(article, "main"):
        return False, "본진 접수·승인됨"
    key = f"{article['slug']}|main"
    prev = state["kits"].get(key)
    h = kit.content_hash(article, "main")
    if prev and prev.get("hash") == h and file_exists(prev.get("zip", "")):
        if is_stale(prev["zip"]):
            return True, "키트가 brand.ts·sources.json·pams_kit.py 보다 오래됨"
        return False, "키트 있음(원고 같음)"
    if state["gate_blocked"].get(key) == gate_key(article, "main"):
        return False, "게이트 막힘(원고·확인 이력 그대로)"
    return True, ("원고 변경" if prev else "새 초안")


def match_capture(filename, candidates):
    """캡처 파일 → 네이버 대기 글. (article | None, 사유). 애매하면 None."""
    stem = os.path.splitext(os.path.basename(filename))[0]
    flat = re.sub(r"\s+", "", stem).lower()
    hits = []
    for a in candidates:
        label = kit.issue_label(a["slug"])
        by_slug = a["slug"].lower() in flat
        by_issue = label.endswith("호") and re.search(rf"(?<!\d){re.escape(label)}", stem) is not None
        nt = re.sub(r"\s+", "", a.get("naver_title") or "")
        by_title = len(flat) >= 6 and nt and flat in nt.lower()
        if by_slug or by_issue or by_title:
            hits.append(a)
    if len(hits) == 1:
        return hits[0], "파일명 일치"
    if len(hits) > 1:
        return None, f"파일명이 여러 글과 맞음({', '.join(kit.issue_label(a['slug']) for a in hits)})"
    # 핵심어 짝 — 파일명의 낱말(「백내장」「도수치료」)이 대기 글 **한 편의 제목에만** 있으면 그 글이다.
    #   (2026-09-30 실측: 로버트가 「백내장.pdf」로 저장하면 호수·6글자 조각 규칙에 안 걸려 짝을 못 찾았다.)
    #   「실비」「보험」처럼 여러 글에 나오는 말·날짜 숫자는 짝으로 치지 않는다. 두 글 이상에 걸리면 묻는다.
    words = [w for w in re.findall(r"[0-9A-Za-z가-힣]+", stem) if len(w) >= 2 and not w.isdigit()
             and not re.fullmatch(r"(스크린샷|캡처|캡쳐|screenshot|capture|네이버|블로그|비공개|pdf|png|jpg)", w.lower())]
    by_word = []
    for w in words:
        owners = [a for a in candidates
                  if w in re.sub(r"\s+", "", (a.get("naver_title") or "") + " " + (a.get("title") or ""))]
        if len(owners) == 1 and owners[0] not in by_word:
            by_word.append(owners[0])
    if len(by_word) == 1:
        return by_word[0], "파일명 핵심어 일치"
    if len(by_word) > 1:
        return None, f"파일명 핵심어가 여러 글과 맞음({', '.join(kit.issue_label(a['slug']) for a in by_word)})"
    if len(candidates) == 1:
        return candidates[0], "네이버 대기 글 1편"
    if not candidates:
        return None, "네이버 대기 글이 없음"
    return None, f"네이버 대기 글 {len(candidates)}편 — 파일명에 호수 없음"


def list_captures(kit_dir, state):
    if not os.path.isdir(kit_dir):
        return []
    out = []
    for fn in sorted(os.listdir(kit_dir)):
        p = os.path.join(kit_dir, fn)
        if not os.path.isfile(p) or not fn.lower().endswith(CAPTURE_EXT):
            continue
        rec = state["captures"].get(fn, {})
        if fn.endswith(".part") or rec.get("status") == "done":
            continue
        if rec.get("status") == "bad" and rec.get("sig") == file_sig(p):
            continue  # 원고와 안 맞아 이미 알린 캡처 — 같은 파일이면 다시 알리지 않는다(덮어쓰면 다시 본다)
        out.append(p)
    return out


def file_sig(path):
    try:
        return f"{os.path.getmtime(path):.0f}:{os.path.getsize(path)}"
    except OSError:
        return ""


# ── 한 바퀴 ─────────────────────────────────────────────────
def scan_zips(kit_dir, state, notify, now=None, days=3):
    """PAMS접수 폴더 맨 위의 최근 zip(손으로 묶은 것 포함)을 검사해 광고시안이 하나가 아니면 알린다(zip 마다 1번).
    스레드 키트(_스레드)는 본문·사진 구성이라 뺀다. 반환: 알린 zip 이름 목록."""
    import time
    now = now or time.time()
    seen = state.setdefault("zip_checked", {})
    out = []
    if not os.path.isdir(kit_dir):
        return out
    for fn in sorted(os.listdir(kit_dir)):
        p = os.path.join(kit_dir, fn)
        if not fn.lower().endswith(".zip") or "_스레드" in fn or not os.path.isfile(p):
            continue
        if now - os.path.getmtime(p) > days * 86400:
            continue
        sig = f"{os.path.getmtime(p):.0f}:{os.path.getsize(p)}"
        if seen.get(fn) == sig:
            continue
        seen[fn] = sig
        try:
            kit.check_zip(p)
        except kit.KitError as e:
            notify(f"🔴 [PAMS zip] {fn} — {e}\n이 zip 은 올리지 마세요(반송 사유).")
            out.append(fn)
        except Exception as e:  # 깨진 zip 등
            notify(f"🔴 [PAMS zip] {fn} — 열 수 없습니다({type(e).__name__})")
            out.append(fn)
    return out


def run_once(env, state, fetch_drafts, build, notify, kit_dir=kit.KIT_DIR, server_factory=None,
             file_exists=os.path.exists):
    """테스트를 위해 DB·빌드·알림·서버를 주입받는다. 만든 키트 목록을 돌려준다."""
    made = []
    jobs = []  # (article, channel, capture)

    main_drafts = fetch_drafts("main")
    for a in main_drafts:
        need, why = needs_main_kit(a, state, file_exists)
        if need:
            jobs.append((a, "main", None, why))

    naver_waiting = [a for a in fetch_drafts("naver") if not kit.channel_locked(a, "naver")]
    for cap in list_captures(kit_dir, state):
        fn = os.path.basename(cap)
        art, why = match_capture(fn, naver_waiting)
        rec = state["captures"].get(fn, {})
        if not art:
            if rec.get("asked") != why:
                notify(f"[PAMS 캡처] {fn} — 짝을 못 정했습니다({why}). "
                       f"파일명에 글의 핵심어(예: 백내장)나 호수(예: 7호)를 넣어 다시 저장해 주세요. 키트는 만들지 않았습니다.")
                state["captures"][fn] = {"status": "asked", "asked": why}
            continue
        if state["gate_blocked"].get(f"{art['slug']}|naver") == gate_key(art, "naver") and rec.get("slug") == art["slug"]:
            continue  # 확인 미완료 그대로 — 서버를 다시 띄우지 않는다
        jobs.append((art, "naver", cap, why))

    log(f"바퀴: 본진 초안 {len(main_drafts)}편 · 네이버 대기 {len(naver_waiting)}편 · 작업 {len(jobs)}건")
    if not jobs:
        return made

    server = server_factory() if server_factory else None
    if server:
        server.__enter__()
    try:
        for a, ch, cap, why in jobs:
            key = f"{a['slug']}|{ch}"
            log(f"키트 시도 {key} ({why})" + (f" · 캡처 {os.path.basename(cap)}" if cap else ""))
            try:
                k = build(env, a, ch, capture=cap, server=server, out_dir=kit_dir)
            except kit.KitError as e:
                if e.gate:
                    state["gate_blocked"][key] = gate_key(a, ch)
                    if cap:
                        state["captures"][os.path.basename(cap)] = {"status": "gate", "slug": a["slug"]}
                    log(f"  건너뜀(게이트): {e}")
                else:
                    log(f"  실패: {e}")
                    notify(f"[PAMS 키트] {kit.title_label(a.get('title'), a['slug'])} {kit.CH_LABEL[ch]} — 만들지 못했습니다: {e}")
                    if cap:   # 같은 캡처로 바퀴마다 같은 알림이 오지 않게(고쳐서 새로 저장하면 다시 본다)
                        state["captures"][os.path.basename(cap)] = {"status": "bad", "slug": a["slug"],
                                                                    "sig": file_sig(cap), "why": str(e)[:300]}
                continue
            state["gate_blocked"].pop(key, None)
            prev = state["kits"].get(key)
            if prev and prev.get("zip") and os.path.normcase(prev["zip"]) != os.path.normcase(k["zip"]):
                for old in (prev["zip"], prev.get("txt", "")):
                    if old and os.path.exists(old):
                        os.remove(old)  # 옛 원고 키트 — 남겨 두면 잘못 올릴 수 있다
            state["kits"][key] = {"zip": k["zip"], "txt": k["txt"], "hash": k["hash"],
                                  "created": datetime.now(kit.KST).isoformat()}
            if cap:
                done = os.path.join(kit_dir, DONE_DIR_NAME)
                os.makedirs(done, exist_ok=True)
                shutil.move(cap, os.path.join(done, os.path.basename(cap)))
                state["captures"][os.path.basename(cap)] = {"status": "done", "slug": a["slug"], "zip": k["zip"]}
            # 원고가 바뀌어 다시 만든 키트는 앞에 표시 — 같은 글 알림이 두 번 와도 헷갈리지 않게
            notify(("🔁 원고 변경 — 키트 다시 만듦 · " if why == "원고 변경" else "") + ready_message(k))
            log(f"  완료: {k['zip']}")
            made.append(k)
    finally:
        if server:
            server.__exit__(None, None, None)
    return made


# ── 스레드: 접수(submitted) 시점 Storage 업로드 ────────────────────
def pick_threads_kit(metas, slug, row_id):
    """키트 목록[(zip경로, kit.json)] 중 이 행에 쓸 스레드 키트. 가장 최근 것.
    댓글이 있는 키트는 row_id 가 같아야 하고(utm_campaign), 댓글 없는 키트는 slug 만 맞으면 된다."""
    ok = [(p, m) for p, m in metas
          if m.get("slug") == slug and (m.get("row_id") in (None, row_id))]
    ok.sort(key=lambda pm: pm[1].get("created") or "", reverse=True)
    return ok[0][0] if ok else None


def threads_kit_metas(kit_dir):
    """스레드 키트 목록[(zip경로, kit.json)]. kit.json 은 zip 밖 <키트이름>.kit/ 에 있다(옛 키트는 zip 안).
    이름을 준 키트(--name, 예: 0929_스레드_간병가족.zip)도 잡는다 — 「_스레드」가 들어간 zip 전부."""
    import pams_threads as th
    out = []
    if not os.path.isdir(kit_dir):
        return out
    for fn in os.listdir(kit_dir):
        if fn.endswith(".zip") and "_스레드" in fn:
            p = os.path.join(kit_dir, fn)
            try:
                out.append((p, th.read_kit_parts(p)[0]))
            except Exception:
                continue
    return out


def upload_submitted_threads(env, notify, kit_dir=kit.KIT_DIR):
    """스레드 행이 submitted/under_review 인데 notes 에 본문 해시가 없으면 → 그 키트의 body/reply 를 올린다.
    (robert-os pams_watch 가 PAMS 목록을 보고 status 를 submitted 로 바꾸면 다음 바퀴에 여기서 잡힌다)"""
    import pams_threads as th
    url, h = kit._rest(env)
    rv = url.rsplit("/", 1)[0] + "/ad_reviews"
    rows = requests.get(rv, params={"channel": "eq.threads", "status": "in.(submitted,under_review)",
                                    "select": "id,article_id,notes,premium_articles(slug)"},
                        headers=h, timeout=30).json()
    metas = None
    for r in rows:
        if th.NOTES_BODY_RX.search(r.get("notes") or ""):
            continue
        slug = (r.get("premium_articles") or {}).get("slug")
        metas = metas if metas is not None else threads_kit_metas(kit_dir)
        zp = pick_threads_kit(metas, slug, r["id"])
        if not zp:
            continue  # 키트 없이 접수된 건(7550 이전 방식) — 건드리지 않는다
        try:
            art = kit.fetch_article(env, slug)
            msg = th.upload_submitted(env, art, zp)
            log(f"스레드 접수 업로드: {msg}")
            notify(f"[스레드 접수] {kit.title_label(art.get('title'), slug)} — body/reply 업로드·해시 기록 완료 ({os.path.basename(zp)})")
        except kit.KitError as e:
            log(f"스레드 접수 업로드 실패 {r['id']}: {e}")


# ── 작업 스케줄러 ───────────────────────────────────────────
def pythonw():
    """예약 작업용 인터프리터 — 시스템 Python 을 우선한다.
    ⚠️ PATH 의 python 이 다른 프로젝트 가상환경(hermes-agent venv)일 수 있다(2026-09-29 실측).
       남의 venv 에 묶이면 그 venv 가 바뀔 때 조용히 멈춘다. requests·PIL 이 있는 시스템 Python 을 쓴다."""
    system = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python", "Python314", "pythonw.exe")
    if os.path.exists(system):
        return system
    exe = sys.executable
    cand = os.path.join(os.path.dirname(exe), "pythonw.exe")
    return cand if os.path.exists(cand) else exe


def install():
    tr = f'"{pythonw()}" "{os.path.abspath(__file__)}"'
    r = subprocess.run(["schtasks", "/Create", "/TN", TASK_NAME, "/SC", "MINUTE", "/MO", "10",
                        "/TR", tr, "/F"], capture_output=True, text=True)
    print(r.stdout or r.stderr)
    return r.returncode


def uninstall():
    r = subprocess.run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"], capture_output=True, text=True)
    print(r.stdout or r.stderr)
    return r.returncode


def acquire_lock():
    os.makedirs(STATE_DIR, exist_ok=True)
    if os.path.exists(LOCK_PATH) and time.time() - os.path.getmtime(LOCK_PATH) > 30 * 60:
        os.remove(LOCK_PATH)  # 30분 넘은 잠금은 죽은 실행
    try:
        fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--install", action="store_true")
    ap.add_argument("--uninstall", action="store_true")
    a = ap.parse_args()
    if a.install:
        sys.exit(install())
    if a.uninstall:
        sys.exit(uninstall())

    if not acquire_lock():
        log("앞 바퀴가 아직 도는 중 — 건너뜀")
        return
    try:
        env = kit.load_env()
        state = load_state()
        made = run_once(
            env, state,
            fetch_drafts=lambda ch: kit.fetch_drafts(env, ch),
            build=lambda *x, **kw: kit.build_kit(*x, **kw, log=log),
            notify=lambda t: telegram(env, t),
            server_factory=lambda: kit.LocalServer(log=log),
        )
        # 접수 순서(configs/pams_queue.json) — 칸이 비면 「다음 접수: ○」 한 줄(같은 상태면 다시 안 보냄).
        try:
            import pams_queue
            pams_queue.notify_next(env, state, notify=lambda t: telegram(env, t), log=log)
        except Exception as e:  # 큐 알림 실패가 키트·게시 바퀴를 막지 않는다
            log(f"큐 알림 실패: {e}")
            # 2026-09-30 18:49 pams_queue.json 이 깨졌을 때 로그에만 남고 아무도 몰랐다 — 하루 한 번 알린다
            alert_once(env, state, f"queue:{type(e).__name__}",
                       f"⚠️ 접수 순서 알림이 멈췄습니다 — {type(e).__name__}: {str(e)[:120]}\n(configs/pams_queue.json 확인)")
        # 본진이 접수되면 → 같은 글 네이버 비공개 게시 안내(한 장 png)를 자동 발송(글마다 1회, 실패는 3회까지 재시도).
        try:
            pams_queue.send_naver_guides(env, state, notify=lambda t: telegram(env, t), log=log)
        except Exception as e:
            log(f"네이버 안내 자동 발송 실패: {e}")
            alert_once(env, state, f"naver-guide:{type(e).__name__}",
                       f"⚠️ 네이버 비공개 게시 안내 자동 발송이 멈췄습니다 — {type(e).__name__}: {str(e)[:120]}")
        try:
            scan_zips(kit.KIT_DIR, state, notify=lambda t: telegram(env, t))
        except Exception as e:
            log(f"zip 검사 실패: {e}")
        # PAMS 에 접수된 본진·네이버인데 ad_reviews 행이 없으면 만든다(감시기 접수 기록 기준 — 10-02 13호 등 재발 방지).
        try:
            import pams_submissions
            pams_submissions.sync(env, state, notify=lambda t: telegram(env, t), log=log)
        except Exception as e:
            log(f"접수 행 생성 실패: {e}")
            alert_once(env, state, f"submissions:{type(e).__name__}",
                       f"⚠️ PAMS 접수 → ad_reviews 행 자동 생성이 멈췄습니다 — {type(e).__name__}: {str(e)[:120]}")
        save_state(state)
        upload_submitted_threads(env, notify=lambda t: telegram(env, t))
        # 심의 승인 → 게시(본진 자동 공개·posted_url, 네이버 공개 전환 안내·RSS URL, 배포 체크, 만료 알림).
        # 로버트 결정 2026-09-30 11:36 「머지다 했고, 본진자동공개 켜」. 팜스 ＋ 는 robert-os 감시기가 한다.
        # 안전장치(publish_approved): review_no·유효기간 · /preview 게이트 · 라이브 번호 미노출이면 실패 알림·URL 미기록 · 본문 무변경.
        # 심의본 원고해시 기록 — 접수·승인 행에 키트 해시를 notes 로 옮긴다(게시 직전 대조의 기준값).
        try:
            import review_lock
            review_lock.stamp(env, state, log=log)
        except Exception as e:
            log(f"원고해시 기록 실패: {e}")
        import publish_approved
        for line in publish_approved.run(env, notify=lambda t: telegram(env, t), live=True):
            log(line)
        # 승인 끝난 키트 → _접수완료\<채널>\ (삭제 없음). 심사중·반송·미접수는 그대로(scripts/pams_folder_tidy.py).
        kit.tidy(env, log=log)
        if made:
            log(f"이번 바퀴 키트 {len(made)}개")
    except Exception:
        log("오류:\n" + traceback.format_exc())
    finally:
        try:
            os.remove(LOCK_PATH)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    main()
