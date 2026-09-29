#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 키트 생성 — 로버트는 zip 을 올리고 자가점검만 체크한다. 나머지는 기계.

    python scripts/pams_kit.py <slug> main
    python scripts/pams_kit.py <slug> naver --capture <네이버 비공개 캡처(.pdf/.png/.jpg)>
    옵션: --base-url http://localhost:3000   (이미 떠 있는 서버를 쓸 때. 없으면 로컬 next dev 를 잠깐 띄운다)

산출물 — %USERPROFILE%\\Downloads\\PAMS접수\\  (2026-09-29 로버트 지정. out\\pams\\ 는 쓰지 않는다)
    MMDD_<N호>_<본진|네이버>.zip  — 캡처 PDF(파일명 = 게시명.pdf) + 증빙 원문(4요소 파일명 그대로)
    MMDD_<N호>_<본진|네이버>.txt  — PAMS 게시명 칸·자료명 칸에 붙여 넣을 문자열
    호수는 configs/issue_numbers.json. 없으면 호수 자리에 slug 가 들어간다.
    자동 생성·네이버 캡처 짝맞추기는 scripts/pams_auto.py (10분 주기).

🔴 게이트 — 컴플라이언스 확인(B등급)이 다 끝나지 않았으면 키트를 만들지 않는다.
   판정은 이 파일이 다시 구현하지 않는다. 로컬 서버의 /preview 라우트가 어드민과 **같은 함수**
   (checkArticleBySlug → checkBannedTerms, level==='clean')로 막는 화면을 그대로 본다.
   우회 옵션은 없다 — 어드민에서 확인을 끝내고 다시 돌린다.

본진 캡처: 웹 심의용 미리보기(/preview/news/<slug>?token=…)를 Puppeteer 로 인쇄(scripts/pams-print.mjs).
   심의필 줄은 공란(제_____호) 그대로다 — 공란이 아니면 멈춘다.
   ⚠️ 운영(Vercel) PREVIEW_SECRET 은 로컬 .env.local 과 다르다(2026-09-29 실측 404). 그래서 로컬 서버를 쓴다.
네이버 캡처: 로버트가 비공개 게시 화면을 캡처한 파일을 받아 PDF 로(이미지면 변환).
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.parse
import zipfile
from datetime import datetime, timedelta, timezone

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_JSON = os.path.join(ROOT, "configs", "sources.json")
ISSUES_JSON = os.path.join(ROOT, "configs", "issue_numbers.json")
EVIDENCE_DIR = os.path.join(ROOT, "compliance", "evidence")
KIT_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "PAMS접수")
PRINT_JS = os.path.join(ROOT, "scripts", "pams-print.mjs")
BLANK_REVIEW = "제_____호"
GATE_TEXT = "컴플라이언스 검사 미통과"
AD_FORM = {"main": "홈페이지", "naver": "바이럴(블로그 등)"}
CH_LABEL = {"main": "본진", "naver": "네이버"}
KST = timezone(timedelta(hours=9))
# 창 없는 실행(작업 스케줄러에서 10분마다 창이 뜨지 않게)
NO_WINDOW = (subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == "nt" else 0

ARTICLE_COLS = ("id,slug,title,naver_title,category,summary,key_points,remodeling_bridge,raw_source_name,"
                "main_website_markdown,naver_blog_content,verify_claims,compliance_acks,naver_image_paths,"
                "is_main_published,is_naver_published,created_at,"
                "ad_reviews(channel,status,posting_title,created_at)")


class KitError(Exception):
    """키트를 만들지 않고 멈춘다. gate=True 면 컴플라이언스 확인 미완료(게이트)."""

    def __init__(self, msg, gate=False):
        super().__init__(msg)
        self.gate = gate


# ── 환경·DB ──────────────────────────────────────────────────
def load_env():
    env = dict(os.environ)
    path = os.path.join(ROOT, ".env.local")
    if os.path.exists(path):
        with open(path, encoding="utf-8-sig") as fp:
            for line in fp:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return env


def _rest(env):
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise KitError("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다")
    return f"{url}/rest/v1/premium_articles", {"apikey": key, "Authorization": f"Bearer {key}"}


def fetch_article(env, slug):
    url, h = _rest(env)
    r = requests.get(url, params={"slug": f"eq.{slug}", "select": ARTICLE_COLS, "limit": "1"}, headers=h, timeout=30)
    if r.status_code != 200 or not r.json():
        raise KitError(f"기사를 찾지 못했습니다 — slug='{slug}' ({r.status_code})")
    return r.json()[0]


def fetch_drafts(env, channel):
    """해당 채널 발행 플래그가 false 인 글 전체(최근 생성순)."""
    url, h = _rest(env)
    flag = "is_main_published" if channel == "main" else "is_naver_published"
    r = requests.get(url, params={flag: "eq.false", "select": ARTICLE_COLS, "order": "created_at.desc"},
                     headers=h, timeout=30)
    r.raise_for_status()
    return r.json()


def channel_locked(article, channel):
    """이 채널이 이미 접수·승인됐는가 — 그러면 키트는 쓸모가 없다(원안 변경 불가)."""
    return any(r.get("channel") == channel and r.get("status") in ("submitted", "approved")
               for r in (article.get("ad_reviews") or []))


# ── 이름·해시 ────────────────────────────────────────────────
def issue_label(slug):
    try:
        n = json.load(open(ISSUES_JSON, encoding="utf-8")).get(slug)
    except FileNotFoundError:
        n = None
    return f"{n}호" if isinstance(n, int) else slug


def kit_basename(slug, channel, now=None):
    now = now or datetime.now(KST)
    return f"{now:%m%d}_{issue_label(slug)}_{CH_LABEL[channel]}"


def content_hash(article, channel):
    """원고 해시 — 키트 내용을 바꾸는 필드만. 바뀌면 키트를 다시 만든다."""
    if channel == "main":
        keys = ["title", "category", "summary", "key_points", "remodeling_bridge", "raw_source_name",
                "main_website_markdown"]
    else:
        keys = ["naver_title", "raw_source_name", "naver_blog_content"]
    canon = json.dumps({k: article.get(k) for k in keys}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def sanitize_posting_title(t):
    """AdReviewPanel.sanitizePostingTitle 과 같은 규칙 — PAMS 게시명 금지 특수문자 제거."""
    t = re.sub(r"[\"'?&—–]", "", t or "")
    return re.sub(r"\s{2,}", " ", t).strip()


def posting_title(article, channel):
    rows = [r for r in (article.get("ad_reviews") or []) if r.get("channel") == channel and r.get("posting_title")]
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    if rows:
        return rows[0]["posting_title"].strip(), "ad_reviews.posting_title"
    base = article.get("title") if channel == "main" else (article.get("naver_title") or article.get("title"))
    return sanitize_posting_title(base), ("title" if channel == "main" else "naver_title") + " 정리"


def safe_filename(name):
    return re.sub(r'[\\/:*?"<>|]', "", name).strip().rstrip(".")


def evidence_for(article, channel):
    """본문(해당 채널)·출처 줄에 자료명이 나오는 대장 항목 → 증빙 파일."""
    body = article.get("main_website_markdown" if channel == "main" else "naver_blog_content") or ""
    flat = re.sub(r"\s+", "", body + (article.get("raw_source_name") or ""))
    srcs = json.load(open(SOURCES_JSON, encoding="utf-8"))["sources"]
    hit = [s for s in srcs if s.get("title") and re.sub(r"\s+", "", s["title"]) in flat]
    if not hit:
        raise KitError("본문에서 configs/sources.json 의 자료명을 찾지 못했습니다 — 증빙 없이 접수할 수 없습니다")
    out = []
    for s in hit:
        f = s.get("evidence_file")
        p = os.path.join(EVIDENCE_DIR, f or "")
        if not f or not os.path.exists(p):
            raise KitError(f"증빙 원문 파일이 없습니다 — {f} (compliance/evidence/)")
        out.append((s, p))
    return out


def source_line(s):
    pub = s.get("published", "")
    return f"{s['org']}, {s['title']}, {pub.split('.')[0]}, {pub}"


# ── 로컬 서버 ────────────────────────────────────────────────
class LocalServer:
    def __init__(self, base_url=None, port=3939, log=print):
        self.base = base_url.rstrip("/") if base_url else f"http://localhost:{port}"
        self.port = port
        self.proc = None
        self.own = not base_url
        self.log = log

    def __enter__(self):
        if self.own:
            self.log(f"· 로컬 서버 기동(next dev :{self.port}) …")
            self.proc = subprocess.Popen(
                f"npx next dev -p {self.port}", cwd=ROOT, shell=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW)
            deadline = time.time() + 300
            while time.time() < deadline:
                try:
                    if requests.get(self.base + "/robots.txt", timeout=5).status_code < 500:
                        break
                except requests.RequestException:
                    pass
                time.sleep(2)
            else:
                self.__exit__(None, None, None)
                raise KitError("로컬 서버가 5분 안에 뜨지 않았습니다")
        return self

    def __exit__(self, *a):
        if self.proc and self.proc.poll() is None:
            if os.name == "nt":
                subprocess.run(f"taskkill /PID {self.proc.pid} /T /F", shell=True, creationflags=NO_WINDOW,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                self.proc.send_signal(signal.SIGTERM)


def preview_url(server, env, slug):
    token = env.get("PREVIEW_SECRET", "")
    if not token:
        raise KitError("PREVIEW_SECRET 가 .env.local 에 없습니다")
    return f"{server.base}/preview/news/{slug}?token={urllib.parse.quote(token)}"


def gate(url):
    """어드민 잠금과 같은 판정 — /preview 서버 게이트 화면을 본다. 첫 컴파일은 오래 걸린다."""
    r = requests.get(url, timeout=300)
    if r.status_code != 200:
        raise KitError(f"미리보기 응답 {r.status_code} — slug·PREVIEW_SECRET 확인")
    html = r.text
    if GATE_TEXT in html:
        m = re.search(r"<b>(\d+)(?:<!-- -->)?건</b>", html)
        raise KitError(f"컴플라이언스 확인이 끝나지 않았습니다 — 남은 {m.group(1) if m else '?'}건. "
                       "어드민 [컴플라이언스] 모달에서 확인을 끝낸 뒤 다시 실행하세요", gate=True)
    return html


def ensure_puppeteer(log=print):
    ok = subprocess.run('node -e "import(\'puppeteer\').then(()=>process.exit(0),()=>process.exit(1))"',
                        cwd=ROOT, shell=True, creationflags=NO_WINDOW).returncode == 0
    if not ok:
        log("· puppeteer 설치(npm install --no-save — CI 와 같은 방식) …")
        if subprocess.run("npm install --no-save puppeteer", cwd=ROOT, shell=True, creationflags=NO_WINDOW,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0:
            raise KitError("puppeteer 설치 실패")


def capture_to_pdf(src, dst):
    ext = os.path.splitext(src)[1].lower()
    if ext == ".pdf":
        shutil.copyfile(src, dst)
        return
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise KitError(f"캡처 형식을 모릅니다 — {ext} (pdf/png/jpg)")
    from PIL import Image
    Image.open(src).convert("RGB").save(dst, "PDF", resolution=150.0)


# ── 키트 ────────────────────────────────────────────────────
def build_kit(env, article, channel, capture=None, server=None, out_dir=KIT_DIR, now=None, log=print):
    """키트를 만든다. 게이트·증빙·캡처 문제면 KitError (파일은 하나도 남기지 않는다).
    server 를 주면 그 서버를 쓰고, 없으면 로컬 next dev 를 띄웠다 끈다."""
    slug = article["slug"]
    if channel == "naver" and not capture:
        raise KitError("네이버 키트는 캡처 파일이 필요합니다")
    if capture and not os.path.exists(capture):
        raise KitError(f"캡처 파일이 없습니다 — {capture}")
    title, title_from = posting_title(article, channel)
    evid = evidence_for(article, channel)
    base = kit_basename(slug, channel, now)
    os.makedirs(out_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as stage:
        pdf_path = os.path.join(stage, safe_filename(title) + ".pdf")
        own = server is None
        srv = LocalServer(log=log) if own else server
        if own:
            srv.__enter__()
        try:
            url = preview_url(srv, env, slug)
            html = gate(url)  # 🔴 두 채널 모두 같은 게이트 — 통과 전에는 아무 파일도 만들지 않는다
            if channel == "main":
                if BLANK_REVIEW not in html:
                    raise KitError("미리보기에 공란 심의필 줄(제_____호)이 없습니다 — 제출용 화면이 아닙니다")
                ensure_puppeteer(log)
                rc = subprocess.run(["node", PRINT_JS, url, pdf_path], cwd=ROOT, creationflags=NO_WINDOW,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
                if rc == 3:
                    raise KitError("컴플라이언스 확인이 끝나지 않았습니다(인쇄 단계에서 재확인)", gate=True)
                if rc != 0 or not os.path.exists(pdf_path):
                    raise KitError(f"인쇄 PDF 생성 실패(rc={rc})")
        finally:
            if own:
                srv.__exit__(None, None, None)

        if channel == "naver":
            capture_to_pdf(capture, pdf_path)
        for _, p in evid:
            shutil.copyfile(p, os.path.join(stage, os.path.basename(p)))

        files = sorted(os.listdir(stage))
        zip_path = os.path.join(out_dir, base + ".zip")
        tmp_zip = zip_path + ".part"
        with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED) as z:
            for fn in files:
                z.write(os.path.join(stage, fn), fn)
        os.replace(tmp_zip, zip_path)

    lines = [
        f"[PAMS 접수 문자열] {issue_label(slug)} · {CH_LABEL[channel]} · {slug}",
        "",
        f"게시명: {title}",
        f"  (출처: {title_from} · 금지 특수문자 ' ? \" & 제거)",
        f"광고형태: {AD_FORM[channel]}",
        "",
        "증빙 자료명 (작성기관명, 자료명, 기준년도, 발표연도):",
    ] + [f"- {source_line(s)}" for s, _ in evid] + ["", "zip 안 파일:"] + [f"- {fn}" for fn in files]
    txt_path = os.path.join(out_dir, base + ".txt")
    open(txt_path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    return {"zip": zip_path, "txt": txt_path, "name": base + ".zip", "title": title,
            "sources": [source_line(s) for s, _ in evid], "files": files,
            "hash": content_hash(article, channel)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("channel", choices=["main", "naver"])
    ap.add_argument("--capture")
    ap.add_argument("--base-url")
    a = ap.parse_args()
    env = load_env()
    try:
        art = fetch_article(env, a.slug)
        server = LocalServer(a.base_url) if a.base_url else None
        kit = build_kit(env, art, a.channel, capture=a.capture, server=server)
    except KitError as e:
        print(f"\n⛔ {e}\n   키트를 만들지 않았습니다.", file=sys.stderr)
        sys.exit(3 if e.gate else 1)
    print(open(kit["txt"], encoding="utf-8").read())
    print(f"✅ {kit['zip']}\n✅ {kit['txt']}")


if __name__ == "__main__":
    main()
