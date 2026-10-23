#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
카카오톡 채널 소식 PAMS 접수 키트 (KC1 추가 B, 2026-10-23).

    python scripts/pams_kit.py <draft-slug> kakao [--check]

원고 = assets/kakao/drafts/<draft-slug>/{body.txt, meta.json}.
  · 채널: 카카오 채널 「신순주의선한금융」 http://pf.kakao.com/_xoxdBwX — PAMS 사전등록 게시물종류 「기타」 승인(2026-10-23 로버트 화면 확인).
  · 🔴 이미 승인된 글(본진·네이버·지식인)을 채널에 그대로 옮겨 싣지 않는다 — 게시위치가 다르므로 새 심의다. 그래서 원고를 새로 쓴다.
  · 본진 링크 = meta.main_slug 의 ad_reviews 에서 channel=main · status=approved · posted_url 이 있는 글만(threads 첫 댓글과 같은 규칙).
    아니면 키트를 만들지 않는다 — 심의 전 페이지로 보내는 링크를 심의 원고에 박지 않는다.

이 키트는 **DB·Storage 에 쓰지 않는다**(읽기만). ad_reviews 행 만들기·접수 뒤 해시 기록(--submitted)은 하지 않는다:
ad_reviews.channel 체크 제약에 'kakao' 가 없고 article_id 가 NOT NULL 이라 스키마 결정이 먼저다(PR 본문 참조).
"""
import json
import os
import re
import tempfile
import zipfile

import pams_kit as kit

KAKAO_CHANNEL_URL = "http://pf.kakao.com/_xoxdBwX"      # brand.ts BRAND.social.kakao 와 같은 값(아래 시험이 대조)
DRAFT_ROOT = os.path.join(kit.ROOT, "assets", "kakao", "drafts")
PASTE_NAME = "카카오 접수 원고.txt"
BODY_MAX = 1000    # [가정] 카카오 채널 소식 글자 수 한도를 실측하지 못했다 — 소식은 짧게 쓰는 원칙의 상한일 뿐이다
# 상담 유인 문구 자체가 업무광고의 본체인 채널이라 「상담」은 막지 않는다. 금소법 공통 금칙(무료·단정·다급함)만 본다.
FORBIDDEN = re.compile(r"무료|공짜|무조건|반드시 해지|지금 바로|당장|늦기 전|마감|절판|100%|최고|최저|유일")
URL_RX = re.compile(r"https?://[^\s)]+")


def load_draft(slug, root=DRAFT_ROOT):
    d = os.path.join(root, slug)
    try:
        body = open(os.path.join(d, "body.txt"), "rb").read().decode("utf-8")
        meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
    except FileNotFoundError as e:
        raise kit.KitError(f"카카오 원고 파일이 없습니다 — {e.filename}")
    if not meta.get("title"):
        raise kit.KitError("meta.json 에 title(게시명)이 없습니다")
    return body, meta


def check_body(body, meta, required=None, actual_loss=None, banned=None, approved_link=None):
    """순수 검사 → 문제 목록(빈 목록이면 통과). required·actual_loss·banned 는 시험에서 주입한다."""
    import preflight
    required = required if required is not None else preflight.parse_required_notices()
    notice, rx = actual_loss if actual_loss is not None else preflight.parse_actual_loss_notice()
    problems = []
    if not body.strip():
        return ["원고가 비었습니다"]
    if "\r" in body:
        problems.append("원고에 CR 이 있습니다 — LF 로 저장하세요")
    if len(body) > BODY_MAX:
        problems.append(f"원고 {len(body)}자 — {BODY_MAX}자 한도(소식은 짧게)")
    for n in required:
        if n not in body:
            problems.append(f"필수 유의문구 누락: {n[:20]}…")
    if rx.search(body + meta.get("title", "")) and notice not in body:
        problems.append("실손 주제 — 개인의견 블록 세 번째 문장(ACTUAL_LOSS_NOTICE) 누락")
    for m in sorted({m.group(0) for m in FORBIDDEN.finditer(body + "\n" + meta.get("title", ""))}):
        problems.append(f"금지 표현 「{m}」")
    if banned:
        problems.append("금지어(A등급): " + ", ".join(banned))
    # 링크 — 본진 승인 글 하나만 허용
    urls = URL_RX.findall(body)
    if meta.get("main_slug"):
        want = kit.main_location(meta["main_slug"])
        if urls != [want]:
            problems.append(f"링크는 본진 글 {want} 하나만(지금 {urls})")
        elif approved_link != want:
            problems.append(f"본진 글 {meta['main_slug']} 이 아직 승인·게시 전이라 링크를 실을 수 없습니다 "
                            f"(ad_reviews main approved + posted_url 필요)")
    elif urls:
        problems.append(f"링크 없는 원고인데 URL 이 있습니다: {urls}")
    return problems


def approved_main_url(article):
    rows = [r for r in (article.get("ad_reviews") or [])
            if r.get("channel") == "main" and r.get("status") == "approved" and (r.get("posted_url") or "").strip()]
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return rows[0]["posted_url"].strip().split("?")[0].split("#")[0] if rows else None


def build_kakao_kit(env, slug, out_dir=kit.KIT_DIR, now=None, log=print, draft_root=DRAFT_ROOT):
    body, meta = load_draft(slug, draft_root)
    import pams_threads as th
    link = None
    if meta.get("main_slug"):
        link = approved_main_url(kit.fetch_article(env, meta["main_slug"]))
    problems = check_body(body, meta, banned=th.banned_hits(body), approved_link=link)
    if problems:
        raise kit.KitError("카카오 원고 검사 미통과 — 키트를 만들지 않습니다:\n  · " + "\n  · ".join(problems))
    title = kit.sanitize_posting_title(meta["title"])
    if title != meta["title"]:
        raise kit.KitError(f"게시명에 PAMS 금지 특수문자 — {meta['title']!r} (임의 치환 금지)")

    # 증빙 — 원고에 「출처:」 줄이 있으면 sources.json 대조(자료명 축약 = 반송 사유). 출처 줄이 없는 소개글은 증빙 없음.
    evid = kit.evidence_for({"naver_blog_content": body, "raw_source_name": ""}, "naver") if "출처:" in body else []

    os.makedirs(out_dir, exist_ok=True)
    base = kit.kit_basename(slug, "kakao", now)
    zip_path = os.path.join(out_dir, base + ".zip")
    with tempfile.TemporaryDirectory() as stage:
        with open(os.path.join(stage, PASTE_NAME), "wb") as fp:
            fp.write(body.encode("utf-8"))
        for _, p in evid:
            with open(os.path.join(stage, os.path.basename(p)), "wb") as fp:
                fp.write(open(p, "rb").read())
        files = sorted(os.listdir(stage))
        with zipfile.ZipFile(zip_path + ".part", "w", zipfile.ZIP_DEFLATED) as z:
            for fn in files:
                z.write(os.path.join(stage, fn), fn)
        os.replace(zip_path + ".part", zip_path)

    lines = [
        f"[PAMS 접수 문자열] 카카오 소식 · {slug}", "",
        f"게시명: {title}",
        f"게시위치: {KAKAO_CHANNEL_URL}",
        "광고형태: 기타 (사전등록 게시물종류 「기타」 · 카카오 채널 — 2026-10-23 승인)",
        "심의유형: [미확정] 팜스 심의유형 팝업에서 확인 — 이미지 없는 텍스트 소식. 원고 txt + 증빙 PDF 를 zip 1개로 올리는 일반심의 경로를 가정",
        "본진 링크: " + (link if link else "없음(채널 소개글)"), "",
        "증빙 자료명 (작성기관명, 자료명, 기준년도, 발표연도):",
    ] + ([f"- {kit.source_line(s)}" for s, _ in evid] or ["- 없음(출처 인용 없는 소개글)"]) + [
        "", "── PAMS 에 붙여 넣을 원고 ──", body.rstrip("\n"), "── 끝 ──", "",
        "필수안내사항: 팜스 카테고리 선택 시 자동생성되면 그 자구가 정본이다(brand.ts 로 덮어쓰지 않는다). 승인 후 실번호·기간만 채워 게시.",
        "zip 안 파일(PAMS 첨부 = 심사 대상만):"] + [f"- {fn}" for fn in files]
    txt_path = os.path.join(out_dir, base + ".txt")
    with open(txt_path, "w", encoding="utf-8", newline="\n") as fp:
        fp.write("\n".join(lines) + "\n")
    return {"zip": zip_path, "txt": txt_path, "name": base + ".zip", "title": title, "link": link,
            "sources": [kit.source_line(s) for s, _ in evid], "files": files}
