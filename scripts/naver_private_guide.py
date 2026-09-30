#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
네이버 심의용 **비공개 게시** 안내 한 장 — 로버트가 네이버에 비공개 글을 올리고 캡처하면 네이버 키트가 된다.

    python scripts/naver_private_guide.py <slug>          # 준비만(파일 생성). 발송 안 함
    python scripts/naver_private_guide.py <slug> --send   # 안내 한 장(png) + 설명을 텔레그램(TELEGRAM_CHAT_ID = PAMS 알림방)으로

산출물 — Downloads\\PAMS접수\\_네이버비공개\\  (🔴 PAMS접수 바로 아래에 두지 않는다 — pams_auto 가 거기 png/pdf 를
    네이버 캡처로 짝지어 키트를 만든다. 사진·안내 png 가 캡처로 오인된다.)
    MMDD_N호_네이버비공개.txt      — 할 일 순서 + 제목 + 본문(조립본, 심의용)
    MMDD_N호_네이버비공개.html     — 서식 참고본(configs/naver-format.json 규격 · 어드민 [게시용 복사]와 같은 변환)
    MMDD_N호_네이버비공개_이미지N  — 네이버 사진(assets/naver/<slug>/, 게시 순서)
    MMDD_N호_네이버비공개_안내.png — 한 장 요약(텔레그램용)

본문은 어드민 compose(mode=submission) — 심의 제출용 조립본(심의필 줄은 공란 예시). 조립 기록(naver_composed_hash)도
    남는다(= 어드민 복사 버튼 1회, preflight 「네이버 osmu」 근거).
🔴 게이트: compose 가 서버 컴플라이언스(level=clean)를 다시 본다 — 확인이 안 끝난 글은 만들지 않는다.
"""
import argparse
import re
import html as htmllib
import json
import os
import subprocess
import sys

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402
import publish_approved as pa  # noqa: E402

OUT_DIR = os.path.join(kit.KIT_DIR, "_네이버비공개")
FORMAT_JSON = os.path.join(kit.ROOT, "configs", "naver-format.json")
STEP_NO = re.compile(r"^\d+\.\s*")


def format_line():
    try:
        f = json.load(open(FORMAT_JSON, encoding="utf-8"))
        s = json.dumps(f, ensure_ascii=False)
    except Exception:
        s = ""
    # 사람이 읽는 한 줄은 publish_approved 안내와 같은 문구로 고정(규격 값은 json 이 정본)
    return "서식 규격: configs/naver-format.json (소제목 24 · 목록 19 · 본문 15 · 필수안내 13 · 색 지정 금지)" + ("" if s else " — ⚠ json 읽기 실패")


def steps(issue, title, n_images, base):
    """할 일 순서 — 순수 함수(테스트 대상)."""
    return [
        "1. 네이버 블로그(insightlab-daily)에서 「글쓰기」를 연다.",
        f"2. 제목 칸에 아래 제목을 그대로 붙여 넣는다(한 글자도 바꾸지 않는다):",
        f"     {title}",
        f"3. 본문: {base}.html 을 크롬으로 열어 전체 선택(Ctrl+A) → 복사 → 네이버 본문에 붙여 넣는다.",
        "   · 서식(글자 크기·굵기)이 같이 들어온다. 색은 지정하지 않는다.",
        f"4. 사진 {n_images}장: 본문의 [이미지①][이미지②][이미지③] 자리에 {base}_이미지1·2·3 을 순서대로 넣고 자리표시 글자는 지운다."
        if n_images else "4. 사진 없음 — [이미지] 자리표시가 있으면 지운다.",
        "5. 필수안내사항의 심의필 줄은 공란(제_____호) 그대로 둔다 — 심의 전이다.",
        "6. 공개 설정 = 「비공개」 → 발행.",
        "7. 발행된 비공개 글 전체를 캡처한다 — 🔴 「비공개」 표시가 화면에 보이게(2025-07-14 시행 규칙).",
        f"8. 캡처 파일 이름에 「{issue}」를 넣어 Downloads\\PAMS접수\\ 에 저장한다(예: {issue}_네이버.png · 여러 장이면 PDF 1개).",
        "   → 10분 안에 pams_auto 가 짝을 맞춰 네이버 키트(zip)를 만든다. 캡처는 캡처_처리됨\\ 으로 옮겨진다.",
        "9. 이 비공개 글이 곧 승인본이다 — 승인 뒤에는 심의필 줄만 채워 「전체공개」로 바꾼다(새로 올리지 않는다).",
    ]


def one_page_html(issue, slug, title, step_lines, n_images):
    # 번호는 <ol> 이 붙인다 — 문장 앞 「N. 」을 떼서 「1. 1.」 이중 번호를 막는다
    items = [htmllib.escape(STEP_NO.sub("", s)) for s in step_lines if not s.startswith(" ")]
    li = "".join(f"<li>{x}</li>" for x in items)
    return (
        "<!doctype html><meta charset='utf-8'><body style=\"margin:0;background:#faf9f6;color:#221e18;"
        "font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif\">"
        "<div style='width:880px;padding:36px 40px'>"
        f"<div style='font-size:15px;color:#6b6457'>네이버 심의용 비공개 게시 · {htmllib.escape(issue)} · {htmllib.escape(slug)}</div>"
        f"<div style='font-size:26px;font-weight:700;margin:10px 0 18px;line-height:1.4'>{htmllib.escape(title)}</div>"
        "<div style='border-top:1px solid #a8842c;margin-bottom:16px'></div>"
        f"<ol style='font-size:18px;line-height:1.75;padding-left:24px;margin:0'>{li}</ol>"
        f"<div style='margin-top:18px;font-size:15px;color:#48423a'>사진 {n_images}장 · {htmllib.escape(format_line())}</div>"
        "</div></body>")


def render_png(html_path, png_path):
    js = (
        "const p=require('puppeteer');(async()=>{const b=await p.launch({headless:true});const g=await b.newPage();"
        "await g.setViewport({width:960,height:600,deviceScaleFactor:2});"
        f"await g.goto('file:///'+{json.dumps(html_path.replace(os.sep, '/'))});"
        f"await g.screenshot({{path:{json.dumps(png_path)},fullPage:true}});await b.close();}})().catch(e=>{{console.error(e);process.exit(1)}});"
    )
    r = subprocess.run(["node", "-e", js], cwd=kit.ROOT, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise kit.KitError(f"안내 png 실패 — {r.stderr.strip()[:200]}")


def build(env, article, server, out_dir=OUT_DIR, now=None):
    slug = article["slug"]
    issue = kit.issue_label(slug)
    base = kit.kit_basename(slug, "naver", now).replace("_네이버", "_네이버비공개")
    body = pa.admin_post(server, env, "/api/admin/compose",
                         {"articleId": article["id"], "channel": "naver", "mode": "submission"})
    os.makedirs(out_dir, exist_ok=True)
    imgs = pa.copy_images(slug, out_dir, base)
    body_path = os.path.join(out_dir, base + "_본문.txt")
    open(body_path, "w", encoding="utf-8", newline="\n").write(body["text"])
    rich = pa.rich_html(body_path, imgs)
    html_path = os.path.join(out_dir, base + ".html")
    open(html_path, "w", encoding="utf-8").write(
        f"<!doctype html><meta charset='utf-8'><title>{htmllib.escape(body['title'])}</title>"
        f"<body style='max-width:860px;margin:24px auto;padding:0 16px'>\n{rich}</body>")
    st = steps(issue, body["title"], len(imgs), base)
    head = [f"[네이버 심의용 비공개 게시] {issue} · {slug}", "", "할 일:"] + ["  " + s for s in st] + [
        "", format_line(), f"사진 {len(imgs)}장: " + (", ".join(imgs) or "없음"), "", "── 본문(조립본 · 심의 제출용) ──"]
    txt_path = os.path.join(out_dir, base + ".txt")
    open(txt_path, "w", encoding="utf-8", newline="\n").write("\n".join(head) + "\n" + body["text"] + "\n")
    page_html = os.path.join(out_dir, base + "_안내.html")
    open(page_html, "w", encoding="utf-8").write(one_page_html(issue, slug, body["title"], st, len(imgs)))
    png_path = os.path.join(out_dir, base + "_안내.png")
    render_png(page_html, png_path)
    os.remove(page_html)
    return {"txt": txt_path, "html": html_path, "png": png_path, "images": imgs, "title": body["title"], "issue": issue}


def send(env, res):
    token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        raise kit.KitError("텔레그램 설정 없음")
    cap = (f"[네이버 비공개 게시 요청] {res['issue']}\n제목: {res['title']}\n"
           f"파일: Downloads\\PAMS접수\\_네이버비공개\\{os.path.basename(res['txt'])} (+.html · 사진 {len(res['images'])}장)\n"
           f"캡처는 이름에 「{res['issue']}」 넣어 Downloads\\PAMS접수\\ 로.")
    with open(res["png"], "rb") as fp:
        r = requests.post(f"https://api.telegram.org/bot{token}/sendPhoto", data={"chat_id": chat, "caption": cap[:1000]},
                          files={"photo": fp}, timeout=60)
    if not (r.ok and r.json().get("ok")):
        raise kit.KitError(f"텔레그램 발송 실패 — {r.text[:200]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--send", action="store_true", help="안내 한 장을 텔레그램으로 보낸다(기본은 준비만)")
    ap.add_argument("--base-url")
    a = ap.parse_args()
    env = kit.load_env()
    art = kit.fetch_article(env, a.slug)
    with kit.LocalServer(base_url=a.base_url, port=3944) as srv:
        res = build(env, art, srv)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.send:
        send(env, res)
        print("텔레그램 발송 완료")


if __name__ == "__main__":
    main()
