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
import shutil
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
import naver_rules  # noqa: E402

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


def keyword_of(title):
    """제목의 첫 낱말(조사 뺀 핵심어) — 파일 이름 예시용. 「백내장 실비 청구했는데 …」 → 백내장"""
    m = re.search(r"[0-9A-Za-z가-힣]{2,}", title or "")
    return m.group(0) if m else "글제목"


KAKAO_BANNER_SRC = r"D:\robert-os\shared\assets\kakao\kakao_chat_goodfinance.png"
BANNER_STEP = "마지막 카톡 배너 — 채팅 링크 직접 걸기, 캡처 전에"

# 블로그 분류 5개(SUP3, 로버트 10/25 「글 작성하면 분류도 알아서」). 규칙: 고지의무·가입 전 확인=실손·보장성 가이드 ·
#   기존 계약 손보기=보험 리모델링 · 청구·지급=보험금 청구·보상 · 연금·노후·세금=연금·노후·세테크 · 보험료 절감=보험료 절약·꿀팁
CATEGORY_UNSURE = "확인 필요"
CATEGORY_WORDS = {
    "실손·보장성 가이드": ["고지", "알릴", "부담보", "가입 전", "가입전", "실손", "실비", "간편", "유병자", "인수", "면책"],
    "보험 리모델링": ["리모델링", "기존 계약", "기존계약", "재설계", "합산", "중복", "보장 점검", "해지"],
    "보험금 청구·보상": ["청구", "지급", "보험금", "심사", "보상", "손해사정"],
    "연금·노후·세테크": ["연금", "노후", "세금", "절세", "세액공제", "비과세", "상속", "증여", "퇴직"],
    "보험료 절약·꿀팁": ["보험료 절", "절약", "절감", "할인", "보험료 줄", "납입 부담"],
}


def blog_category(title, keyword="", text="", db_category=None):
    """원고 제목·키워드(가중 3)와 본문(칸당 최대 3)에서 분류 5개 중 하나를 고른다. 근거가 약하거나 동점이면 「확인 필요」.
    DB premium_articles.category 가 분류 5개 중 하나면 그 값이 먼저다(CP1 — 법인편이 「보험 리모델링」인데 본문 동점으로
    「확인 필요」가 나왔다). 순수 함수(테스트 대상)."""
    if db_category in CATEGORY_WORDS:
        return db_category
    head = f"{title or ''} {keyword or ''}"
    body = (text or "").split(NOTICE_RULE)[0]
    score = {}
    for cat, words in CATEGORY_WORDS.items():
        h = sum(1 for w in words if w in head)
        b = sum(body.count(w) for w in words)
        score[cat] = 3 * h + min(b, 3)
    ranked = sorted(score.items(), key=lambda kv: -kv[1])
    if ranked[0][1] < 3 or ranked[0][1] == ranked[1][1]:
        return CATEGORY_UNSURE
    return ranked[0][0]


def banner_name(base):
    return f"{base}_카톡배너.png"


def copy_banner(out_dir, base, src=None):
    """카톡 배너 원본을 같은 폴더에 복사 → 파일명. 원본이 없으면 KitError(링크는 넣지 않는다 — 로버트가 직접)."""
    src = src or KAKAO_BANNER_SRC
    if not os.path.isfile(src):
        raise kit.KitError(f"카톡 배너 원본이 없습니다 — {src}")
    name = banner_name(base)
    shutil.copyfile(src, os.path.join(out_dir, name))
    return name


def append_banner(rich, name):
    """html 맨 끝(진단 CTA 이미지 다음)에 배너 이미지 자리 — 링크(<a>) 없이 이미지만."""
    return rich.rstrip("\n") + f'\n<img src="{htmllib.escape(name)}" width="800" style="width:100%;max-width:800px;height:auto;">\n'


TITLE_BOX = "■ 제목 칸에 붙여 넣을 제목 — 이것 하나뿐"


def title_box(title, naver_only=False):
    """붙여 넣을 제목은 **딱 하나**, 맨 위 별도 상자(2026-10-01 7호: 안내문에 제목처럼 보이는 줄이 둘이라
    로버트가 헷갈렸고, 끝에 마침표가 붙은 제목으로 올라갔다). DB naver_title 그대로 · 끝 문장부호 없음.
    네이버 단독 글은 본진 링크 줄(📄)이 붙지 않는다(SH16)."""
    bar = "━" * 40
    tail = ("  (본문·html 안에는 제목이 없다. 네이버 단독 글이라 본진 글 링크 줄(📄)은 없다.)" if naver_only else
            "  (본문·html 안에는 제목이 없다. 본문 맨 끝 「📄 …」 줄은 본진 글 링크이고 제목이 아니다.)")
    return [TITLE_BOX, bar, f"  {title}", bar, tail]


def check_title(title):
    """끝 문장부호가 붙은 제목은 안내문을 만들지 않는다 — 원고(naver_title)부터 고친다."""
    t = (title or "").strip()
    if not t:
        raise kit.KitError("네이버 제목(naver_title)이 비어 있습니다")
    if re.search(r"[.。!?…,]$", t):
        raise kit.KitError(f"네이버 제목 끝에 문장부호가 있습니다 — 「{t}」. 원고의 naver_title 부터 고치세요")
    return t


def steps(issue, title, n_images, base):
    """할 일 순서 — 순수 함수(테스트 대상)."""
    keyword = keyword_of(title)
    return [
        "1. 네이버 블로그(insightlab-daily)에서 「글쓰기」를 연다.",
        "2. 제목 칸에 맨 위 상자의 제목을 그대로 붙여 넣는다(한 글자도 바꾸지 않는다 · 끝에 마침표를 붙이지 않는다).",
        f"3. 본문: {base}.html 을 크롬으로 열어 전체 선택(Ctrl+A) → 복사 → 네이버 본문에 붙여 넣는다. "
        "html 안에는 제목이 없다 — 첫 사진 아래 따옴표 문장은 본문 첫 줄이니 지우지 않는다.",
        "   · 서식(글자 크기·굵기)이 같이 들어온다. 색은 지정하지 않는다.",
        f"4. 사진 {n_images}장: html 안 [이미지N] 자리에 {base}_이미지N 이 이미 들어 있다(마지막 진단 카드는 링크 포함). "
        "붙여 넣은 뒤 빠진 사진이 있으면 그 자리에 넣고 남아 있는 자리표시 줄([이미지…])만 지운다 — 앞뒤 문장은 건드리지 않는다."
        if n_images else "4. 사진 없음 — [이미지] 자리표시 줄만 지운다.",
        f"5. {BANNER_STEP}. (html 맨 끝 진단 카드 다음의 카톡 배너 사진에 로버트가 채팅 링크를 건다)",
        "6. 필수안내사항의 심의필 줄은 공란(제_____호) 그대로 둔다 — 심의 전이다.",
        "7. 공개 설정 = 「비공개」 → 발행.",
        "8. 발행된 비공개 글 전체를 캡처한다 — 🔴 「비공개」 표시가 화면에 보이게(2025-07-14 시행 규칙).",
        f"9. 비공개 글을 PDF 로 저장할 때 저장 위치를 Downloads\\PAMS접수\\ 로, 파일 이름에 「{issue}」 또는 글의 핵심어(예: {keyword})를 넣는다"
        f"(예: {issue}.pdf · {keyword}.pdf). 압축은 하지 않는다 — zip 은 자동으로 만들어진다.",
        "   → 10분 안에 pams_auto 가 짝을 맞춰 네이버 키트(zip)를 만든다. 캡처는 캡처_처리됨\\ 으로 옮겨진다.",
        "   → PDF 첫 장 제목이 상자 제목과 다르거나 본문 첫 줄이 빠졌으면 zip 을 만들지 않고 텔레그램으로 알린다"
        f" — 글을 고친 뒤 다른 이름(예: {issue}_수정.pdf)으로 다시 저장한다.",
        "10. 이 비공개 글이 곧 승인본이다 — 승인 뒤에는 심의필 줄만 채워 「전체공개」로 바꾼다(새로 올리지 않는다).",
    ]


def one_page_html(issue, slug, title, step_lines, n_images, category=None):
    # 번호는 <ol> 이 붙인다 — 문장 앞 「N. 」을 떼서 「1. 1.」 이중 번호를 막는다
    items = [htmllib.escape(STEP_NO.sub("", s)) for s in step_lines if not s.startswith(" ")]
    li = "".join(f"<li>{x}</li>" for x in items)
    return (
        "<!doctype html><meta charset='utf-8'><body style=\"margin:0;background:#faf9f6;color:#221e18;"
        "font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif\">"
        "<div style='width:880px;padding:36px 40px'>"
        f"<div style='font-size:15px;color:#6b6457'>네이버 심의용 비공개 게시 · {htmllib.escape(issue)} · {htmllib.escape(slug)}</div>"
        "<div style='border:2px solid #1b3a30;border-radius:6px;padding:12px 16px;margin:12px 0 18px'>"
        f"<div style='font-size:14px;color:#1b3a30;font-weight:700'>{htmllib.escape(TITLE_BOX[2:])}</div>"
        f"<div style='font-size:26px;font-weight:700;margin-top:6px;line-height:1.4'>{htmllib.escape(title)}</div></div>"
        f"<ol style='font-size:18px;line-height:1.75;padding-left:24px;margin:0'>{li}</ol>"
        + (f"<div style='margin-top:14px;font-size:18px;font-weight:700;color:#1b3a30'>분류: {htmllib.escape(category)}</div>" if category else "")
        + f"<div style='margin-top:18px;font-size:15px;color:#48423a'>사진 {n_images}장 · {htmllib.escape(format_line())}</div>"
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


NOTICE_RULE = "─────────────"
_HEAD_SKIP = re.compile(r"^([-•·▶>|📄#\[\"“'‘「─]|\d+\.\s|[QA]\.\s|https?://)")


def source_headings(text):
    """원고 소제목 — 빈 줄 뒤 블록의 첫 줄 중 소제목 모양(40자 이하·문장부호/「다」로 안 끝남). 순수 함수(테스트 대상).

    naver-rich.ts 와 **따로** 센다 — 같은 함수로 세면 변환기가 틀려도 게이트가 같이 틀린다.
    """
    out, prev_blank = [], True
    for raw in text.split(NOTICE_RULE)[0].split("\n"):
        ln = raw.strip()
        if not ln:
            prev_blank = True
            continue
        if (prev_blank and len(ln) <= 40 and not _HEAD_SKIP.match(ln) and not re.search(r"[.?!다]$", ln)
                and " · " not in ln):
            out.append(ln)
        prev_blank = False
    return out


def check_rich_headings(text, rich):
    """🔴 24px 소제목이 원고 소제목보다 적으면 멈춘다(NF1 — 24호 html 이 소제목 0개로 조용히 나갔다)."""
    want = source_headings(text)
    got = rich.count("font-size:24px")
    if got < len(want):
        raise kit.KitError(f"네이버 서식 html 소제목 {got}개 < 원고 소제목 {len(want)}개 — 산출물을 만들지 않았습니다"
                           f" (원고 소제목: {' / '.join(want[:12])})")
    return got


def existing_outputs(out_dir, base):
    """이미 있는 같은 이름 산출물(MMDD_N호_네이버비공개.* · _본문 · _이미지N · _안내) — 순수 함수(테스트 대상)."""
    if not os.path.isdir(out_dir):
        return []
    return sorted(n for n in os.listdir(out_dir)
                  if n.startswith(base) and n[len(base):len(base) + 1] in (".", "_"))


def build(env, article, server, out_dir=OUT_DIR, now=None, force=False):
    slug = article["slug"]
    issue = kit.issue_label(slug)
    base = kit.kit_basename(slug, "naver", now).replace("_네이버", "_네이버비공개")
    # 🔴 같은 이름 파일이 있으면 덮어쓰기 전에 멈춘다 — 관제탑이 손으로 만든 안내(SH16 18·19·20호)를 지우지 않게.
    #    compose 를 부르기 전에 본다(조립 기록 naver_composed_hash 도 남기지 않는다).
    taken = existing_outputs(out_dir, base)
    if taken and not force:
        raise kit.KitError(f"{out_dir} 에 같은 이름 파일이 이미 있습니다 — {', '.join(taken[:4])}"
                           + (f" 외 {len(taken) - 4}개" if len(taken) > 4 else "")
                           + ". 덮어쓰지 않았습니다(다시 만들려면 --force)")
    # 🔴 근거 문장 게이트(CP1) — 근거 자료명 없는 네이버판은 비공개 파일을 만들지 않는다(pams_auto 가 키트를 못 만든다)
    fails = kit.check_naver_basis(article.get("naver_blog_content"), article.get("main_website_markdown"),
                                  article.get("raw_source_name") or "")
    if fails:
        raise kit.KitError("네이버 근거 문장 게이트 — 산출물을 만들지 않았습니다:\n  · " + "\n  · ".join(fails))
    body = pa.admin_post(server, env, "/api/admin/compose",
                         {"articleId": article["id"], "channel": "naver", "mode": "submission"})
    os.makedirs(out_dir, exist_ok=True)
    imgs = pa.copy_images(slug, out_dir, base)
    body_path = os.path.join(out_dir, base + "_본문.txt")
    open(body_path, "w", encoding="utf-8", newline="\n").write(body["text"])
    rich = pa.rich_html(body_path, imgs)
    try:
        check_rich_headings(body["text"], rich)
    except kit.KitError:
        # 틀린 파일을 남기지 않는다 — 방금 쓴 본문·사진을 거둔다
        for n in [base + "_본문.txt", *imgs]:
            try:
                os.remove(os.path.join(out_dir, n))
            except OSError:
                pass
        raise
    html_path = os.path.join(out_dir, base + ".html")
    title = check_title(body["title"])
    banner = copy_banner(out_dir, base)
    rich = append_banner(rich, banner)
    category = blog_category(title, naver_rules.keyword_for(slug) or "", body["text"], article.get("category"))
    # 탭 이름에도 제목을 쓰지 않는다 — 붙여 넣을 제목은 txt·png 맨 위 상자 하나뿐
    open(html_path, "w", encoding="utf-8").write(
        f"<!doctype html><meta charset='utf-8'><title>{htmllib.escape(issue)} 네이버 본문 (제목 아님)</title>"
        f"<body style='max-width:860px;margin:24px auto;padding:0 16px'>\n{rich}</body>")
    st = steps(issue, title, len(imgs), base)
    head = [f"[네이버 심의용 비공개 게시] {issue} · {slug}", f"분류: {category}", ""] + title_box(title, kit.naver_only(article)) + ["", "할 일:"] + ["  " + s for s in st] + [
        "", format_line(), f"사진 {len(imgs)}장: " + (", ".join(imgs) or "없음"), "", "── 본문(조립본 · 심의 제출용) ──"]
    txt_path = os.path.join(out_dir, base + ".txt")
    open(txt_path, "w", encoding="utf-8", newline="\n").write("\n".join(head) + "\n" + body["text"] + "\n")
    page_html = os.path.join(out_dir, base + "_안내.html")
    open(page_html, "w", encoding="utf-8").write(one_page_html(issue, slug, title, st, len(imgs), category))
    png_path = os.path.join(out_dir, base + "_안내.png")
    render_png(page_html, png_path)
    os.remove(page_html)
    return {"txt": txt_path, "html": html_path, "png": png_path, "images": imgs, "title": title, "issue": issue,
            "slug": slug, "banner": banner, "category": category}


def send(env, res):
    token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        raise kit.KitError("텔레그램 설정 없음")
    kw = keyword_of(res["title"])
    # 캡션엔 머리말 표기만(제목 전체를 쓰면 「제목 (7호)」를 통째로 복사할 수 있다) — 제목은 사진 속 상자 하나뿐
    cap = (f"[네이버 비공개 게시 요청] {kit.title_label(res['title'], res.get('slug', ''))}\n"
           f"분류: {res.get('category', CATEGORY_UNSURE)}\n"
           "제목은 사진 맨 위 「제목 칸에 붙여 넣을 제목」 상자의 것 하나만 쓴다.\n"
           f"파일: Downloads\\PAMS접수\\_네이버비공개\\{os.path.basename(res['txt'])} (+.html · 사진 {len(res['images'])}장)\n"
           f"▶ 비공개 글 PDF 를 Downloads\\PAMS접수\\ 에 「{kw}.pdf」(또는 「{res['issue']}.pdf」)로 저장만 하면 zip 은 10분 안에 자동 생성 — 압축·이름 맞추기 불필요.")
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
    ap.add_argument("--force", action="store_true", help="같은 이름 산출물이 있어도 덮어쓴다(기본은 멈춤)")
    a = ap.parse_args()
    env = kit.load_env()
    art = kit.fetch_article(env, a.slug)
    try:
        with kit.LocalServer(base_url=a.base_url, port=3944) as srv:
            res = build(env, art, srv, force=a.force)
    except kit.KitError as e:
        print(str(e))
        sys.exit(1)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.send:
        send(env, res)
        print("텔레그램 발송 완료")
    kit.tidy(env)


if __name__ == "__main__":
    main()
