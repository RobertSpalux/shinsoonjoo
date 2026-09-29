#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
스레드 PAMS 접수 키트 · 접수 단계 Storage 업로드 — robert-os 무인 게시 파이프라인이 기대하는 형식.

    python scripts/pams_kit.py <slug> threads [--body <본문.txt>] [--reply-phrase "<문구>"]
    python scripts/pams_kit.py <slug> threads --submitted <키트.zip>

기준: robert-os finance/THREADS_AUTO.md (PR #58 8c63222 · #61 2b78e83). 7550 실게시(post Dd22lg-gXJh).

한 건 = **본문 + 본인 첫 댓글(본진 링크) 한 세트.** PAMS 에는 둘을 한 원고로 붙여 넣는다:
    <본문>
    (빈 줄)
    [첫 댓글]
    <댓글>

첫 댓글(reply.txt) 규칙
  · 링크 대상 = ad_reviews 에서 channel=main · status=approved · posted_url 있는 **본진 글만.**
    없으면 reply.txt 를 만들지 않는다 → 본문만(7550 방식).
  · URL = 본진 posted_url + ?utm_source=threads&utm_campaign=<스레드 ad_reviews.id>
    (심의 전이라 심의번호를 쓸 수 없다). id 가 필요하므로 댓글이 있을 때만 스레드 행을 draft 로 만든다.
  · 문구 한두 줄. 상담 유인·단정·비교·「무료」 금지(금소법). 문구 전체가 심의 대상이다.

접수 단계 업로드(--submitted — PAMS 에 접수한 뒤)
  · 그 키트 zip 안의 body.txt · reply.txt **바이트 그대로** card-news/threads/<ad_reviews.id>/ 에 올린다.
    🔴 승인 뒤에 본문·댓글을 새로 만들지 않는다. 그러면 심의본이 아니다.
  · notes 에 「본문 <url> (sha256 …) · 댓글 <url> (sha256 …)」 — robert-os 가 이 꼴에서 해시를 뽑는다.
    형식을 바꾸지 말 것. **새 줄**에 쓴다 — 같은 줄 앞에 「댓글」 낱말이 있으면 댓글 해시 정규식이
    본문 해시를 잡는다(robert-os 정규식은 줄 단위).

필수안내 이미지(notice.png)
  · 접수 시 불필요 — 승인 후 robert-os 가 번호 넣어 생성(scripts/threads_notice.py, THREADS_AUTO.md).
    7550 도 원고(텍스트)만 접수했고, 승인 뒤 PAMS 「게시명·비고·심의필번호 확인」 화면의 번호·기간으로
    만들어 게시했다(로버트 확인 2026-09-29 14:56). 그래서 키트에 넣지 않는다.

사진(--photo, 여러 장)
  · 사진은 **광고 내용**이다 → 키트에 넣어 심의받는다(게시 순서 = 인자 순서, 필수안내 이미지는 맨 뒤).
  · 개인 사진은 저장소에 커밋하지 않는다. Storage 에만 올린다.
  · --stage: 접수 전 준비 id(uuid)를 만들어 card-news/threads/<준비id>/ 에 body.txt·사진을 올린다.
    PAMS 접수 뒤 --submitted 가 그 준비 id 로 ad_reviews 행을 만든다(robert-os 가 id 폴더를 먼저 본다).
"""
import uuid
import hashlib
import json
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime

import requests

import pams_kit as kit

THREADS_PROFILE = "https://www.threads.com/@goodfinance_sj"  # 7550 게시명 칸과 같은 값
POSTING_TITLE_FORBIDDEN = "'?\"&"  # PAMS 게시명 금지 특수문자 — 있으면 멈춘다(임의 치환 금지)
REPLY_PHRASE = "제도와 근거를 원문과 함께 정리해 둔 글입니다."
BODY_MAX = 500  # 스레드 글자 수 한도(robert-os 도 같은 한도로 본다)
PASTE_MARK = "[첫 댓글]"
KIT_META = "kit.json"
PASTE_NAME = "스레드 접수 원고.txt"
SIDECAR_SUFFIX = ".kit"  # zip 밖 내부 파일 폴더 — <키트이름>.kit/{kit.json, body.txt, reply.txt}
# 첫 댓글 문구 금지(금소법 — 상담 유인·단정·비교·무료). 금지어 대장(banned-terms.ts)은 따로 한 번 더 본다.
REPLY_FORBIDDEN = re.compile(r"상담|문의|연락|카톡|카카오|신청|무료|공짜|최고|최저|유일|확실|반드시|무조건|보장해|비교|추천|지금 바로|늦기 전")
NOTES_BODY_RX = re.compile(r"본문[^\n]*?sha256\s*([0-9a-fA-F]{8,64})")   # robert-os threads_post.py 와 같은 식
NOTES_REPLY_RX = re.compile(r"(?:댓글|reply)[^\n]*?sha256\s*([0-9a-fA-F]{8,64})")


# ── 순수 함수(테스트 대상) ─────────────────────────────────────
def main_link(article):
    """본진 승인·게시 URL. 없으면 None → 첫 댓글 없음."""
    rows = [r for r in (article.get("ad_reviews") or [])
            if r.get("channel") == "main" and r.get("status") == "approved" and (r.get("posted_url") or "").strip()]
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return rows[0]["posted_url"].strip() if rows else None


def reply_url(post_url, row_id):
    base = post_url.split("?")[0].split("#")[0]
    return f"{base}?utm_source=threads&utm_campaign={row_id}"


def check_reply_phrase(phrase):
    phrase = (phrase or "").strip()
    if not phrase:
        raise kit.KitError("첫 댓글 문구가 비었습니다")
    if phrase.count("\n") > 1:
        raise kit.KitError("첫 댓글 문구는 한두 줄입니다")
    m = REPLY_FORBIDDEN.search(phrase)
    if m:
        raise kit.KitError(f"첫 댓글 문구에 금지 표현 「{m.group(0)}」 — 상담 유인·단정·비교·무료 금지(금소법)")
    if re.search(r"https?://", phrase):
        raise kit.KitError("문구에 URL 을 넣지 마세요 — 본진 URL 은 자동으로 붙습니다")
    return phrase


def compose_reply(phrase, post_url, row_id):
    return f"{check_reply_phrase(phrase)}\n{reply_url(post_url, row_id)}"


def compose_paste(body, reply, tag=None):
    """PAMS 에 붙여 넣을 한 덩어리. 댓글이 없으면 본문만. 주제 태그가 있으면 맨 끝에 「#태그」 한 줄.

    🔴 태그도 심의받는다 — 승인 뒤 붙이면 심의본 가공이다(2026-09-29 관제탑). 그래서 접수 원고에 넣는다.
       body.txt(게시 본문·해시 대상)에는 넣지 않는다 — 스레드 주제 태그는 본문이 아니라 따로 다는 칸이다.
    """
    text = body if reply is None else f"{body}\n\n{PASTE_MARK}\n{reply}"
    return text if not tag else f"{text}\n\n#{tag}"


# 주제 태그 — 글당 1개, 일반어만. 금소법 금지 표현·상품명·회사명 금지.
TAG_RX = re.compile(r"[0-9A-Za-z가-힣_]{1,30}")
TAG_FORBIDDEN = re.compile(r"상담|문의|연락|카톡|카카오|신청|무료|공짜|최고|최저|최대|유일|확실|반드시|무조건"
                           r"|보장해|보장됨|보장받|100|비교|추천|순위|1위|절판|마감|다이렉트|온라인보험|지금|당장")
INSURER_SUFFIX_RX = re.compile(r"[가-힣A-Za-z]{1,6}(생명|화재|해상|라이프|손해보험|손보)$")


def insurer_names():
    """banned-terms.ts INSURERS(국내 생·손보사 상호) — 금지어 대장이 단일 출처."""
    import preflight
    ts = open(preflight.BANNED_TS, encoding="utf-8").read()
    m = re.search(r"const INSURERS = \[(.*?)\];", ts, re.S)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else []


def check_tag(tag):
    """주제 태그 1개 → # 없이 돌려준다. 없으면 None. 규칙 위반은 KitError(고쳐 쓰지 않는다)."""
    if tag is None:
        return None
    t = tag.strip()
    if t.startswith("#"):
        t = t[1:]
    if not t:
        raise kit.KitError("주제 태그가 비었습니다")
    if not TAG_RX.fullmatch(t):
        raise kit.KitError(f"주제 태그는 1개, 공백·#·쉼표 없이 한글·영문·숫자 30자 이내 — {tag!r}")
    m = TAG_FORBIDDEN.search(t)
    if m:
        raise kit.KitError(f"주제 태그에 금지 표현 「{m.group(0)}」 — 상담 유인·단정·비교·추천·무료 금지(금소법)")
    if any(n in t for n in insurer_names()) or (INSURER_SUFFIX_RX.search(t)
                                                and t not in ("생명보험", "화재보험", "손해보험")):
        raise kit.KitError(f"주제 태그에 회사명 — {tag!r}. 간병·간병보험 같은 일반어만")
    hits = banned_hits(t)
    if hits:
        raise kit.KitError(f"주제 태그에 금지어(A등급) — {', '.join(hits)}")
    return t


def notes_line(base, row_id, body_bytes, reply_bytes):
    """robert-os 가 해시를 뽑는 꼴 — 「본문 <url> (sha256 …) · 댓글 <url> (sha256 …)」."""
    root = f"{base.rstrip('/')}/storage/v1/object/public/card-news/threads/{row_id}"
    s = f"본문 {root}/body.txt (sha256 {hashlib.sha256(body_bytes).hexdigest()})"
    if reply_bytes is not None:
        s += f" · 댓글 {root}/reply.txt (sha256 {hashlib.sha256(reply_bytes).hexdigest()})"
    return s


def check_body(body):
    if not body.strip():
        raise kit.KitError("스레드 본문이 비었습니다")
    if len(body) > BODY_MAX:
        raise kit.KitError(f"스레드 본문이 {len(body)}자 — {BODY_MAX}자 한도")
    if "\r" in body:
        raise kit.KitError("본문에 CR 이 있습니다 — LF 로 저장하세요(.gitattributes: assets/threads/**/*.txt eol=lf). "
                           "줄바꿈이 다르면 sha256 이 심의본과 달라집니다")
    if PASTE_MARK in body:
        raise kit.KitError(f"본문에 「{PASTE_MARK}」 표시가 들어 있습니다")


def banned_hits(text):
    """금지어 대장(banned-terms.ts) A등급 — preflight 와 같은 파서."""
    import preflight
    graded = preflight.parse_banned_terms()
    return sorted({term for term, rx in graded["A"] if rx.search(text)})


# ── DB·Storage ──────────────────────────────────────────────
def _rest(env, table):
    url, h = kit._rest(env)
    return url.rsplit("/", 1)[0] + "/" + table, h


def ensure_draft_row(env, article):
    """utm_campaign 에 쓸 스레드 행 id. 이 글의 스레드 draft 행이 있으면 그것, 없으면 새로 만든다."""
    drafts = [r for r in (article.get("ad_reviews") or [])
              if r.get("channel") == "threads" and r.get("status") == "draft"]
    drafts.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    if drafts:
        return drafts[0]["id"], False
    url, h = _rest(env, "ad_reviews")
    r = requests.post(url, json={"article_id": article["id"], "channel": "threads", "status": "draft",
                                 "review_type": "general", "ad_form": "스레드",
                                 "posting_title": THREADS_PROFILE,
                                 "notes": "pams_kit threads — utm_campaign 용 행(접수 전 draft)"},
                      headers={**h, "Content-Type": "application/json", "Prefer": "return=representation"},
                      timeout=30)
    if r.status_code >= 300:
        raise kit.KitError(f"스레드 draft 행을 만들지 못했습니다 — {r.status_code} {r.text[:200]}")
    return r.json()[0]["id"], True


def _upload(env, path, data, content_type):
    base = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    r = requests.post(f"{base}/storage/v1/object/{path}", data=data,
                      headers={**h, "Content-Type": content_type, "x-upsert": "false"}, timeout=60)
    public = f"{base}/storage/v1/object/public/{path}"
    if r.status_code >= 300:
        # 이미 있으면 같은 바이트일 때만 받아들인다(접수본이 바뀌는 것을 막는다)
        g = requests.get(public, timeout=30)
        if g.status_code == 200 and g.content == data:
            return public
        raise kit.KitError(f"업로드 실패 {path} — {r.status_code} {r.text[:160]}")
    g = requests.get(public, timeout=30)
    if g.status_code != 200 or g.content != data:
        raise kit.KitError(f"업로드 확인 실패 {public} — {g.status_code}")
    return public


# ── 키트 ────────────────────────────────────────────────────
def default_body_path(slug):
    return os.path.join(kit.ROOT, "assets", "threads", "drafts", slug, "body.txt")


PHOTO_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}


def check_photos(photos):
    """사진 경로 목록 → [(게시 파일명, 경로, content-type)]. 순서 = 게시 순서."""
    out, seen = [], set()
    for p in photos or []:
        if not os.path.exists(p):
            raise kit.KitError(f"사진 파일이 없습니다 — {p}")
        name = os.path.basename(p)
        ext = os.path.splitext(name)[1].lower()
        if ext not in PHOTO_EXT:
            raise kit.KitError(f"사진 형식은 jpg/png — {name}")
        if name in seen or name in ("body.txt", "reply.txt", "notice.png", KIT_META):
            raise kit.KitError(f"사진 파일명이 겹칩니다 — {name}")
        seen.add(name)
        out.append((name, p, PHOTO_EXT[ext]))
    return out


def posting_fields(body, n_photos):
    """PAMS 칸 값 — 🔴 심의 경로에 따라 칸 수가 갈린다.

    · 텍스트만(스레드 전용 경로 jumgumpyoji): 칸이 「게시명」 하나 → 종전대로 계정 URL(7550 방식).
    · 사진 있음(일반심의 → 업무광고 → 광고형태 스레드, jumgumpyo #upadsaj): 칸이 둘이다.
      게시명(gasinm) = 글 이름 = **body.txt 첫 줄 그대로**(새로 짓지 않는다),
      게시(사용)위치(locations) = 계정 URL. 규격 = 「스레드 텍스트 + 이미지 N장」.
      robert-os pams_apply 가 「게시명:」「게시위치:」 줄을 따로 읽는다(2026-09-29 관제탑).
    · 첫 줄에 PAMS 금지 특수문자(' ? " &)가 있으면 멈춘다 — 고쳐 쓰면 심의본과 달라진다.
    """
    if not n_photos:
        return {"게시명": THREADS_PROFILE}
    first = body.split("\n", 1)[0]
    if not first.strip():
        raise kit.KitError("본문 첫 줄이 비어 있어 게시명을 만들 수 없습니다")
    bad = [c for c in POSTING_TITLE_FORBIDDEN if c in first]
    if bad:
        raise kit.KitError(f"게시명(본문 첫 줄)에 PAMS 금지 특수문자 {' '.join(bad)} — 멈춤(임의 치환 금지): {first}")
    return {"게시명": first, "게시위치": THREADS_PROFILE, "규격": f"스레드 텍스트 + 이미지 {n_photos}장"}


def sidecar_dir(zip_path):
    """zip 밖 내부 파일 폴더(<키트이름>.kit).

    🔴 PAMS 첨부 zip 에는 **심사 대상만** 넣는다 — 접수 원고 txt 1개 + 광고 사진 + 증빙 PDF(2026-09-29 관제탑).
       kit.json(slug·article_id·prep_id)은 내부 관리용이라 심사자에게 보일 이유가 없고,
       body.txt 는 원고 txt 와 바이트까지 같은 중복이다. reply.txt 는 원고 txt 의 「[첫 댓글]」 블록과 같다.
       셋은 이 폴더에 두고, 접수 뒤 --submitted(sha256 대조·Storage 업로드)가 여기서 읽는다.
    """
    stem = zip_path[:-4] if zip_path.lower().endswith(".zip") else zip_path
    return stem + SIDECAR_SUFFIX


def read_kit_parts(zip_path):
    """키트 내용 — (meta, body bytes, reply bytes|None, [(사진 이름, bytes)]).

    내부 파일은 zip 옆 <키트이름>.kit/ 에서, 사진은 zip 에서 읽는다.
    그 폴더가 없으면 옛 키트(zip 안에 kit.json·body.txt 가 든 것)로 읽는다 — 0929 이전 키트 호환.
    zip 에 원고 txt 가 있으면 body/reply 로 다시 조립한 것과 바이트까지 같아야 한다.
    다르면 심의받은 원고와 올릴 본문이 갈린 것이므로 멈춘다.
    """
    side = sidecar_dir(zip_path)
    with zipfile.ZipFile(zip_path) as z:
        names = set(z.namelist())
        if os.path.isdir(side):
            def rd(n):
                p = os.path.join(side, n)
                if not os.path.exists(p):
                    return None
                with open(p, "rb") as fp:
                    return fp.read()
        else:
            def rd(n):
                return z.read(n) if n in names else None
        meta_b, body = rd(KIT_META), rd("body.txt")
        if meta_b is None or body is None:
            raise kit.KitError(f"키트 내부 파일(kit.json·body.txt)이 없습니다 — {side}")
        meta = json.loads(meta_b)
        reply = rd("reply.txt")
        photos = [(n, z.read(n)) for n in meta.get("photos") or []]
        paste = z.read(PASTE_NAME) if PASTE_NAME in names else None
    if paste is not None:
        want = compose_paste(body.decode("utf-8"),
                             reply.decode("utf-8") if reply is not None else None,
                             meta.get("tag")).encode("utf-8")
        if paste != want:
            raise kit.KitError("zip 의 접수 원고와 내부 body/reply 가 다릅니다 — 심의본과 올릴 본문이 갈립니다")
    return meta, body, reply, photos


def build_threads_kit(env, article, body_path=None, phrase=None, server=None, out_dir=kit.KIT_DIR,
                      now=None, log=print, photos=None, stage_upload=False, name=None, prep_id=None, tag=None):
    slug = article["slug"]
    photo_list = check_photos(photos)
    body_path = body_path or default_body_path(slug)
    if not os.path.exists(body_path):
        raise kit.KitError(f"스레드 본문 파일이 없습니다 — {body_path}")
    body_bytes = open(body_path, "rb").read()
    body = body_bytes.decode("utf-8")
    check_body(body)
    fields = posting_fields(body, len(photo_list))
    tag = check_tag(tag)

    link = main_link(article)
    phrase = check_reply_phrase(phrase or REPLY_PHRASE) if link else None

    # 증빙 — 본문에 쓴 자료명
    probe = {**article, "naver_blog_content": body, "raw_source_name": ""}
    evid = kit.evidence_for(probe, "naver")

    # 🔴 게이트 — 글 단위 컴플라이언스(어드민 잠금과 같은 /preview 판정) + 스레드 원고 금지어 A등급
    own = server is None
    srv = kit.LocalServer(log=log) if own else server
    if own:
        srv.__enter__()
    try:
        kit.gate(kit.preview_url(srv, env, slug))
    finally:
        if own:
            srv.__exit__(None, None, None)

    row_id, created = (None, False)
    reply = None
    if link:
        row_id, created = ensure_draft_row(env, article)
        reply = compose_reply(phrase, link, row_id)
        if len(reply) > BODY_MAX:
            raise kit.KitError(f"첫 댓글이 {len(reply)}자 — {BODY_MAX}자 한도")
    hits = banned_hits(body + "\n" + (reply or ""))
    if hits:
        raise kit.KitError(f"스레드 원고에 금지어(A등급) — {', '.join(hits)}")

    paste = compose_paste(body, reply, tag)
    if name and not re.fullmatch(r"[0-9A-Za-z가-힣_-]{3,60}", name):
        raise kit.KitError(f"키트 이름은 한글·영문·숫자·_- 3~60자 — {name!r}")
    base = name or kit.kit_basename(slug, "threads", now)
    if prep_id and not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", prep_id):
        raise kit.KitError(f"준비 id 는 uuid — {prep_id!r}")
    os.makedirs(out_dir, exist_ok=True)
    with tempfile.TemporaryDirectory() as stage:
        def put(name, data):
            with open(os.path.join(stage, name), "wb") as fp:
                fp.write(data)
        # 🔴 zip = 심사 대상만(원고 txt 1개 + 사진 + 증빙). 내부 파일은 아래 sidecar_dir 로 — sidecar_dir 주석 참조
        put(PASTE_NAME, paste.encode("utf-8"))
        for name, p, _ in photo_list:
            put(name, open(p, "rb").read())
        prep_id = (prep_id or str(uuid.uuid4())) if stage_upload else None
        for _, p in evid:
            put(os.path.basename(p), open(p, "rb").read())
        files = sorted(os.listdir(stage))
        zip_path = os.path.join(out_dir, base + ".zip")
        with zipfile.ZipFile(zip_path + ".part", "w", zipfile.ZIP_DEFLATED) as z:
            for fn in files:
                z.write(os.path.join(stage, fn), fn)
        os.replace(zip_path + ".part", zip_path)

    side = sidecar_dir(zip_path)
    side_tmp = side + ".part"
    shutil.rmtree(side_tmp, ignore_errors=True)
    os.makedirs(side_tmp)

    def put_side(n, data):
        with open(os.path.join(side_tmp, n), "wb") as fp:
            fp.write(data)
    put_side("body.txt", body_bytes)
    if reply is not None:
        put_side("reply.txt", reply.encode("utf-8"))
    put_side(KIT_META, json.dumps({"slug": slug, "article_id": article["id"], "row_id": row_id,
                                   "prep_id": prep_id, "photos": [n for n, _, _ in photo_list],
                                   "posting_title": fields["게시명"], "tag": tag,
                                   "main_url": link, "created": datetime.now(kit.KST).isoformat()},
                                  ensure_ascii=False, indent=1).encode("utf-8"))
    shutil.rmtree(side, ignore_errors=True)
    os.replace(side_tmp, side)

    staged = []
    if stage_upload:
        folder = f"card-news/threads/{prep_id}"
        staged.append(("body.txt", _upload(env, f"{folder}/body.txt", body_bytes, "text/plain; charset=utf-8"),
                       hashlib.sha256(body_bytes).hexdigest()))
        for name, p, ct in photo_list:
            data = open(p, "rb").read()
            staged.append((name, _upload(env, f"{folder}/{name}", data, ct), hashlib.sha256(data).hexdigest()))

    lines = [
        f"[PAMS 접수 문자열] {kit.issue_label(slug)} · 스레드 · {slug}",
        "",
        f"게시명: {fields['게시명']}",
    ] + [f"{k}: {fields[k]}" for k in ("게시위치", "규격") if k in fields] + (
        [f"태그: {tag}", "  (주제 태그 1개 — 접수 원고 끝 「#" + tag + "」 줄로 함께 심의. 승인 뒤 바꾸거나 더하지 않는다)"]
        if tag else []) + [
        "광고형태: 스레드 · 심의유형: " + ("사진이 있으니 일반심의(이미지 첨부)" if photo_list else "스레드(텍스트)"),
        "첫 댓글: " + (f"있음 → {link} (스레드 행 {row_id}{' 새로 만듦' if created else ''})" if reply
                     else "없음 — 본진 글이 아직 승인·게시 전(본문만 접수, 7550 방식)"),
        "필수안내 이미지: 접수 시 불필요 — 승인 후 robert-os 가 번호 넣어 생성",
        "사진: " + (" → ".join(n for n, _, _ in photo_list) + " (게시 순서, 필수안내 이미지는 맨 뒤)" if photo_list else "없음"),
        "",
        "증빙 자료명 (작성기관명, 자료명, 기준년도, 발표연도):",
    ] + [f"- {kit.source_line(s)}" for s, _ in evid] + [
        "", "── PAMS 에 붙여 넣을 원고 ──", paste, "── 끝 ──", ""] + (
        [f"Storage 준비 폴더 card-news/threads/{prep_id}/ (PAMS 접수 뒤 --submitted 가 이 id 로 ad_reviews 행을 만든다):"]
        + [f"- {n}  {u}  sha256 {h}" for n, u, h in staged] + [""] if staged else []) + [
        "접수 뒤: python scripts/pams_kit.py " + slug + " threads --submitted \"" + zip_path + "\"",
        "", f"키트 내부 파일(zip 밖 — PAMS 에 올리지 않음, 접수 뒤 --submitted 가 읽음): {side}",
        "", "zip 안 파일(PAMS 첨부 = 심사 대상만):"] + [f"- {fn}" for fn in files]
    txt_path = os.path.join(out_dir, base + ".txt")
    open(txt_path, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
    return {"zip": zip_path, "txt": txt_path, "name": base + ".zip", "title": fields["게시명"], "sidecar": side,
            "location": fields.get("게시위치"), "spec": fields.get("규격"), "tag": tag,
            "sources": [kit.source_line(s) for s, _ in evid], "files": files, "reply": reply,
            "row_id": row_id, "paste": paste, "prep_id": prep_id, "staged": staged}


def _insert_submitted_row(env, article, prep_id, posting_title=THREADS_PROFILE):
    """PAMS 접수 뒤 — 준비 id 로 스레드 행을 만든다(Storage 폴더와 id 를 맞춘다)."""
    url, h = _rest(env, "ad_reviews")
    r = requests.post(url, json={"id": prep_id, "article_id": article["id"], "channel": "threads",
                                 "status": "submitted", "submitted_at": datetime.now(kit.KST).isoformat(),
                                 "review_type": "general", "ad_form": "스레드", "posting_title": posting_title},
                      headers={**h, "Content-Type": "application/json", "Prefer": "return=representation"},
                      timeout=30)
    if r.status_code >= 300:
        raise kit.KitError(f"스레드 접수 행을 만들지 못했습니다 — {r.status_code} {r.text[:200]}")
    return r.json()[0]


def upload_submitted(env, article, zip_path):
    """PAMS 접수 뒤 — 키트의 body/reply 를 그대로 올리고 notes 에 해시 줄을 붙인다."""
    meta, body, reply, photos = read_kit_parts(zip_path)
    if meta.get("slug") != article["slug"]:
        raise kit.KitError(f"키트의 글({meta.get('slug')})과 인자 slug 가 다릅니다")
    rows = [r for r in (article.get("ad_reviews") or []) if r.get("channel") == "threads"]
    if meta.get("prep_id") and not meta.get("row_id"):
        row = next((r for r in rows if r["id"] == meta["prep_id"]), None)
        if not row:
            row = _insert_submitted_row(env, article, meta["prep_id"],
                                        meta.get("posting_title") or THREADS_PROFILE)
    elif meta.get("row_id"):
        row = next((r for r in rows if r["id"] == meta["row_id"]), None)
        if not row:
            raise kit.KitError(f"키트의 스레드 행 {meta['row_id']} 이 ad_reviews 에 없습니다")
    else:
        cand = [r for r in rows if r.get("status") in ("draft", "submitted", "under_review")
                and not NOTES_BODY_RX.search(r.get("notes") or "")]
        cand.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        if not cand:
            raise kit.KitError("이 글의 스레드 접수 행(draft/submitted, 본문 해시 없음)이 없습니다 — "
                               "어드민 [제출 기록] 뒤 다시 실행하세요")
        row = cand[0]
    if row.get("status") == "approved" or NOTES_BODY_RX.search(row.get("notes") or ""):
        raise kit.KitError(f"행 {row['id']} 은 이미 승인됐거나 본문 해시가 기록돼 있습니다 — 덮어쓰지 않습니다")

    folder = f"card-news/threads/{row['id']}"
    body_url = _upload(env, f"{folder}/body.txt", body, "text/plain; charset=utf-8")
    reply_url_ = _upload(env, f"{folder}/reply.txt", reply, "text/plain; charset=utf-8") if reply is not None else None
    photo_notes = []
    for n, data in photos:
        ct = PHOTO_EXT.get(os.path.splitext(n)[1].lower(), "application/octet-stream")
        u = _upload(env, f"{folder}/{n}", data, ct)
        photo_notes.append(f"사진 {n} {u} (sha256 {hashlib.sha256(data).hexdigest()})")
    line = notes_line(env["NEXT_PUBLIC_SUPABASE_URL"], row["id"], body, reply)
    if photo_notes:  # 사진은 다음 줄 — 본문·댓글 해시 줄을 건드리지 않는다
        line += "\n" + " · ".join(photo_notes)
    if meta.get("tag"):  # robert-os 게시 게이트가 대조한다 — 심의받은 태그 그대로만 단다
        line += f"\n태그 #{meta['tag']}"
    # 🔴 새 줄에 쓴다 — robert-os 정규식은 줄 안에서 「본문」·「댓글」 첫 등장부터 sha256 을 찾는다.
    #    앞 메모에 「댓글」 낱말이 같은 줄에 있으면 본문 해시를 댓글 해시로 읽는다.
    head = (row.get("notes") or "").rstrip()
    notes = (head + "\n" if head else "") + f"{datetime.now(kit.KST):%m-%d %H:%M} 접수 원고 · " + line
    patch = {"notes": notes}
    if row.get("status") == "draft":
        patch.update({"status": "submitted", "submitted_at": datetime.now(kit.KST).isoformat()})
    url, h = _rest(env, "ad_reviews")
    r = requests.patch(url, params={"id": f"eq.{row['id']}"}, json=patch,
                       headers={**h, "Content-Type": "application/json", "Prefer": "return=minimal"}, timeout=30)
    if r.status_code >= 300:
        raise kit.KitError(f"notes 기록 실패 — {r.status_code} {r.text[:200]}")
    return f"✅ 행 {row['id']} · 본문 {body_url}" + (f" · 댓글 {reply_url_}" if reply_url_ else " · 댓글 없음")
