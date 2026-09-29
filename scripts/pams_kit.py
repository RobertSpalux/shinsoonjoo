#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 키트 생성 — 로버트는 zip 을 올리고 자가점검만 체크한다. 나머지는 기계.

    python scripts/pams_kit.py <slug> main
    python scripts/pams_kit.py <slug> naver --capture <네이버 비공개 캡처(.pdf/.png/.jpg)>
    옵션: --base-url http://localhost:3000   (이미 떠 있는 서버를 쓸 때. 없으면 로컬 next dev 를 잠깐 띄운다)

산출물 (out/pams/, .gitignore 대상)
    <slug>_<main|naver>.zip  — 캡처 PDF(파일명 = 게시명.pdf) + 증빙 원문(4요소 파일명 그대로)
    <slug>_<main|naver>.txt  — PAMS 게시명 칸·자료명 칸에 붙여 넣을 문자열

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
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.parse
import zipfile

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_JSON = os.path.join(ROOT, "configs", "sources.json")
EVIDENCE_DIR = os.path.join(ROOT, "compliance", "evidence")
OUT_DIR = os.path.join(ROOT, "out", "pams")
PRINT_JS = os.path.join(ROOT, "scripts", "pams-print.mjs")
BLANK_REVIEW = "제_____호"
GATE_TEXT = "컴플라이언스 검사 미통과"
AD_FORM = {"main": "홈페이지", "naver": "바이럴(블로그 등)"}


def fail(msg, code=1):
    print(f"\n⛔ {msg}\n   키트를 만들지 않았습니다.", file=sys.stderr)
    sys.exit(code)


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


def fetch_article(env, slug):
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        fail("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다")
    cols = ("id,slug,title,naver_title,raw_source_name,main_website_markdown,naver_blog_content,"
            "verify_claims,ad_reviews(channel,status,posting_title,created_at)")
    r = requests.get(f"{url}/rest/v1/premium_articles",
                     params={"slug": f"eq.{slug}", "select": cols, "limit": "1"},
                     headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
    if r.status_code != 200 or not r.json():
        fail(f"기사를 찾지 못했습니다 — slug='{slug}' ({r.status_code})")
    return r.json()[0]


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
        fail("본문에서 configs/sources.json 의 자료명을 찾지 못했습니다 — 증빙 없이 접수할 수 없습니다")
    out = []
    for s in hit:
        f = s.get("evidence_file")
        p = os.path.join(EVIDENCE_DIR, f or "")
        if not f or not os.path.exists(p):
            fail(f"증빙 원문 파일이 없습니다 — {f} (compliance/evidence/)")
        out.append((s, p))
    return out


# ── 로컬 서버 ────────────────────────────────────────────────
class LocalServer:
    def __init__(self, base_url, port=3939):
        self.base = base_url.rstrip("/") if base_url else f"http://localhost:{port}"
        self.port = port
        self.proc = None
        self.own = not base_url

    def __enter__(self):
        if self.own:
            print(f"· 로컬 서버 기동(next dev :{self.port}) …")
            flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
            self.proc = subprocess.Popen(
                f"npx next dev -p {self.port}", cwd=ROOT, shell=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
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
                fail("로컬 서버가 5분 안에 뜨지 않았습니다")
        return self

    def __exit__(self, *a):
        if self.proc and self.proc.poll() is None:
            if os.name == "nt":
                subprocess.run(f"taskkill /PID {self.proc.pid} /T /F", shell=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                self.proc.send_signal(signal.SIGTERM)


def preview_url(server, env, slug):
    token = env.get("PREVIEW_SECRET", "")
    if not token:
        fail("PREVIEW_SECRET 가 .env.local 에 없습니다")
    return f"{server.base}/preview/news/{slug}?token={urllib.parse.quote(token)}"


def gate(url):
    """어드민 잠금과 같은 판정 — /preview 서버 게이트 화면을 본다. 첫 컴파일은 오래 걸린다."""
    r = requests.get(url, timeout=300)
    if r.status_code != 200:
        fail(f"미리보기 응답 {r.status_code} — slug·PREVIEW_SECRET 확인")
    html = r.text
    if GATE_TEXT in html:
        m = re.search(r"<b>(\d+)(?:<!-- -->)?건</b>", html)
        fail(f"컴플라이언스 확인이 끝나지 않았습니다 — 남은 {m.group(1) if m else '?'}건. "
             "어드민 [컴플라이언스] 모달에서 확인을 끝낸 뒤 다시 실행하세요", code=3)
    return html


def ensure_puppeteer():
    ok = subprocess.run('node -e "import(\'puppeteer\').then(()=>process.exit(0),()=>process.exit(1))"',
                        cwd=ROOT, shell=True).returncode == 0
    if not ok:
        print("· puppeteer 설치(npm install --no-save — CI 와 같은 방식) …")
        if subprocess.run("npm install --no-save puppeteer", cwd=ROOT, shell=True).returncode != 0:
            fail("puppeteer 설치 실패")


def capture_to_pdf(src, dst):
    ext = os.path.splitext(src)[1].lower()
    if ext == ".pdf":
        shutil.copyfile(src, dst)
        return
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        fail(f"캡처 형식을 모릅니다 — {ext} (pdf/png/jpg)")
    from PIL import Image
    Image.open(src).convert("RGB").save(dst, "PDF", resolution=150.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("channel", choices=["main", "naver"])
    ap.add_argument("--capture")
    ap.add_argument("--base-url")
    a = ap.parse_args()
    if a.channel == "naver" and not a.capture:
        fail("네이버 키트는 --capture <비공개 게시 캡처 파일> 이 필요합니다")
    if a.capture and not os.path.exists(a.capture):
        fail(f"캡처 파일이 없습니다 — {a.capture}")

    env = load_env()
    art = fetch_article(env, a.slug)
    title, title_from = posting_title(art, a.channel)
    evid = evidence_for(art, a.channel)

    os.makedirs(OUT_DIR, exist_ok=True)
    stage = os.path.join(OUT_DIR, f"{a.slug}_{a.channel}")
    pdf_name = safe_filename(title) + ".pdf"
    pdf_path = os.path.join(stage, pdf_name)

    with LocalServer(a.base_url) as server:
        url = preview_url(server, env, a.slug)
        html = gate(url)  # 🔴 두 채널 모두 같은 게이트 — 통과 전에는 아무 파일도 만들지 않는다
        shutil.rmtree(stage, ignore_errors=True)
        os.makedirs(stage)
        if a.channel == "main":
            if BLANK_REVIEW not in html:
                fail("미리보기에 공란 심의필 줄(제_____호)이 없습니다 — 제출용 화면이 아닙니다")
            ensure_puppeteer()
            rc = subprocess.run(["node", PRINT_JS, url, pdf_path], cwd=ROOT).returncode
            if rc == 3:
                fail("컴플라이언스 확인이 끝나지 않았습니다(인쇄 단계에서 재확인)", code=3)
            if rc != 0 or not os.path.exists(pdf_path):
                fail(f"인쇄 PDF 생성 실패(rc={rc})")

    if a.channel == "naver":
        capture_to_pdf(a.capture, pdf_path)

    for _, p in evid:
        shutil.copyfile(p, os.path.join(stage, os.path.basename(p)))

    zip_path = stage + ".zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for fn in sorted(os.listdir(stage)):
            z.write(os.path.join(stage, fn), fn)

    lines = [
        f"[PAMS 접수 문자열] {a.slug} · {a.channel}",
        "",
        f"게시명: {title}",
        f"  (출처: {title_from} · 금지 특수문자 ' ? \" & 제거)",
        f"광고형태: {AD_FORM[a.channel]}",
        "",
        "증빙 자료명 (작성기관명, 자료명, 기준년도, 발표연도):",
    ]
    for s, p in evid:
        pub = s.get("published", "")
        lines.append(f"- {s['org']}, {s['title']}, {pub.split('.')[0]}, {pub}")
    lines += ["", "zip 안 파일:"] + [f"- {fn}" for fn in sorted(os.listdir(stage))]
    txt_path = stage + ".txt"
    open(txt_path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    shutil.rmtree(stage, ignore_errors=True)

    print("\n".join(lines))
    print(f"\n✅ {zip_path}\n✅ {txt_path}")


if __name__ == "__main__":
    main()
