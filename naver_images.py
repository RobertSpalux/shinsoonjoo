#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
신순주의 선한 금융 — 네이버 블로그 이미지 3종 렌더러 (고정 틀)
글마다 아래 CONFIG 의 텍스트만 교체해서 재사용한다.
DESIGN-SPEC 토큰 준수: 크림 배경 / 딥그린 밴드 / 골드는 헤어라인만 / 웜 차콜 텍스트
"""
from PIL import Image, ImageDraw, ImageFont
import os

# ────────────────────────────────────────────────
# CONFIG — 글마다 여기만 바꾼다
# ────────────────────────────────────────────────
CONFIG = {
    "slug": "disclosure-exclusion-2026",
    "overline": "가입·고지 가이드",
    "title": "수술 이력 있는데\n보험 가입되나요?",
    "subtitle": "거절보다 흔한 건 '조건부 가입'입니다",
    # 정보 도식 — 비교표 (라벨, 좌, 우)
    "table_title": "부담보, 두 가지가 다릅니다",
    "table_head": ("기간 부담보", "전기간 부담보"),
    "table_rows": [
        ("보장 제외", "정해진 기간만", "계약 기간 내내"),
        ("해제 시점", "기간이 지나면", "요건 충족 시"),
        ("해제 요건", "기간 경과", "5년간 진단·치료 없을 것"),
        ("청구 안 하면", "무관", "진료기록으로 판단"),
    ],
    "table_note": "금융감독원 분쟁 판단기준 · 약관에 따라 다를 수 있습니다",
    # 핵심 포인트 카드
    "points_title": "이건 반드시 알리셔야 합니다",
    "points": [
        "최근 3개월 — 확정진단·의심소견·치료·입원·수술·투약",
        "최근 1년 — 건강검진 등에서 추가검사(재검사)를 받은 경우",
        "최근 5년 — 입원·수술, 7일 이상 치료, 30일 이상 투약",
    ],
    "cta_line": "내 계약에 뭐가 빠져 있을까요?",
    "cta_sub": "담보 단위로 리모델링 점검",
    "cta_url": "goodfinance.kr/diagnosis",
}

OUT_DIR = "/home/claude/work/naver_out"

# ────────────────────────────────────────────────
# 브랜드 토큰 (DESIGN-SPEC)
# ────────────────────────────────────────────────
CREAM = "#faf9f6"
CREAM_SOFT = "#f3efe7"
WHITE = "#ffffff"
LINE = "#e8e2d6"
TEXT_STRONG = "#221e18"
TEXT_BODY = "#48423a"
TEXT_MUTED = "#6b6457"
FOREST = "#1b3a30"
FOREST_SOFT = "#24493d"
GOLD = "#a8842c"

W = 800  # 네이버 본문 가로

FONT_DIR = "/usr/share/fonts/opentype/noto"


def kr_index(path):
    """ttc 안에서 한국어(KR) 폰트 인덱스를 찾는다."""
    for i in range(12):
        try:
            f = ImageFont.truetype(path, 20, index=i)
            name = " ".join(f.getname())
            if "KR" in name:
                return i
        except Exception:
            break
    return 0


SANS_PATHS = {
    "black": f"{FONT_DIR}/NotoSansCJK-Black.ttc",
    "bold": f"{FONT_DIR}/NotoSansCJK-Bold.ttc",
    "medium": f"{FONT_DIR}/NotoSansCJK-Medium.ttc",
    "regular": f"{FONT_DIR}/NotoSansCJK-Regular.ttc",
}
SERIF_PATHS = {
    "bold": f"{FONT_DIR}/NotoSerifCJK-Bold.ttc",
    "semibold": f"{FONT_DIR}/NotoSerifCJK-SemiBold.ttc",
}

_IDX = {p: kr_index(p) for p in list(SANS_PATHS.values()) + list(SERIF_PATHS.values())}


def sans(weight, size):
    p = SANS_PATHS[weight]
    return ImageFont.truetype(p, size, index=_IDX[p])


def serif(weight, size):
    p = SERIF_PATHS[weight]
    return ImageFont.truetype(p, size, index=_IDX[p])


def text_w(d, s, f):
    box = d.textbbox((0, 0), s, font=f)
    return box[2] - box[0]


def wrap(d, s, f, max_w):
    """한글 기준 글자 단위 줄바꿈(공백 우선)."""
    words = s.split(" ")
    lines, cur = [], ""
    for wd in words:
        trial = (cur + " " + wd).strip()
        if text_w(d, trial, f) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


# ────────────────────────────────────────────────
# ① 대표 썸네일 — 딥그린 밴드 (검색 클릭률용)
# ────────────────────────────────────────────────
def render_thumbnail(cfg):
    H = 800
    img = Image.new("RGB", (W, H), FOREST)
    d = ImageDraw.Draw(img)

    pad = 72

    # 오버라인 라벨
    f_over = sans("medium", 24)
    d.text((pad, pad + 6), cfg["overline"], font=f_over, fill="#a9bfb5")

    # 골드 헤어라인 (허용 용도: 얇은 선)
    d.line([(pad, pad + 54), (pad + 48, pad + 54)], fill=GOLD, width=2)

    # 타이틀 (세리프 · 크림)
    f_title = serif("bold", 62)
    y = pad + 110
    for line in cfg["title"].split("\n"):
        d.text((pad, y), line, font=f_title, fill=CREAM)
        y += 86

    # 서브타이틀
    f_sub = sans("medium", 30)
    y += 18
    d.text((pad, y), cfg["subtitle"], font=f_sub, fill="#c9d6cf")

    # 하단 골드 헤어라인 + 브랜드
    d.line([(pad, H - 150), (W - pad, H - 150)], fill=GOLD, width=1)
    f_brand = sans("bold", 27)
    d.text((pad, H - 122), "신순주의 선한 금융", font=f_brand, fill=CREAM)
    f_brand_sub = sans("regular", 21)
    d.text((pad, H - 84), "23년 차 GA명장 · 보험 리모델링", font=f_brand_sub, fill="#a9bfb5")

    return img


# ────────────────────────────────────────────────
# ② 정보 도식 — 비교표 (크림 배경)
# ────────────────────────────────────────────────
def render_table(cfg):
    H = 800
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)
    pad = 64

    f_h = serif("bold", 44)
    d.text((pad, pad + 8), cfg["table_title"], font=f_h, fill=TEXT_STRONG)
    d.line([(pad, pad + 78), (pad + 40, pad + 78)], fill=GOLD, width=2)

    # 표 영역
    top = pad + 130
    row_h = 108
    col1 = pad
    col2 = pad + 170
    col3 = pad + 420

    f_head = sans("bold", 24)
    head_l, head_r = cfg.get("table_head", ("이전", "이후"))
    d.text((col2, top), head_l, font=f_head, fill=TEXT_MUTED)
    d.text((col3, top), head_r, font=f_head, fill=FOREST)
    d.line([(pad, top + 44), (W - pad, top + 44)], fill=LINE, width=1)

    f_label = sans("bold", 27)
    f_before = sans("regular", 25)
    f_after = sans("bold", 27)

    y = top + 76
    for label, before, after in cfg["table_rows"]:
        d.text((col1, y + 20), label, font=f_label, fill=TEXT_STRONG)

        for i, ln in enumerate(wrap(d, before, f_before, col3 - col2 - 24)):
            d.text((col2, y + 6 + i * 34), ln, font=f_before, fill=TEXT_MUTED)

        for i, ln in enumerate(wrap(d, after, f_after, W - pad - col3)):
            d.text((col3, y + 4 + i * 36), ln, font=f_after, fill=FOREST)

        y += row_h
        d.line([(pad, y - 12), (W - pad, y - 12)], fill=LINE, width=1)

    f_note = sans("regular", 21)
    d.text((pad, H - 78), cfg.get("table_note", ""), font=f_note, fill=TEXT_MUTED)

    return img


# ────────────────────────────────────────────────
# ③ 핵심 포인트 + CTA — 딥그린 밴드
# ────────────────────────────────────────────────
def render_points_cta(cfg):
    H = 800
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)
    pad = 64

    f_h = serif("bold", 42)
    d.text((pad, pad), cfg["points_title"], font=f_h, fill=TEXT_STRONG)
    d.line([(pad, pad + 72), (pad + 40, pad + 72)], fill=GOLD, width=2)

    f_num = sans("black", 34)
    f_body = sans("medium", 27)
    y = pad + 128
    for i, p in enumerate(cfg["points"], 1):
        d.text((pad, y - 4), str(i), font=f_num, fill=GOLD)
        lines = wrap(d, p, f_body, W - pad * 2 - 52)
        for j, ln in enumerate(lines):
            d.text((pad + 52, y + j * 40), ln, font=f_body, fill=TEXT_BODY)
        y += max(len(lines), 1) * 40 + 42

    # 하단 딥그린 CTA 밴드
    band_top = H - 250
    d.rectangle([(0, band_top), (W, H)], fill=FOREST)
    d.line([(pad, band_top + 44), (pad + 48, band_top + 44)], fill=GOLD, width=2)

    f_cta = sans("bold", 34)
    d.text((pad, band_top + 74), cfg["cta_line"], font=f_cta, fill=CREAM)
    f_cta_sub = sans("regular", 25)
    d.text((pad, band_top + 128), cfg["cta_sub"], font=f_cta_sub, fill="#a9bfb5")
    f_url = sans("bold", 26)
    d.text((pad, band_top + 176), cfg["cta_url"], font=f_url, fill=GOLD)

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    slug = CONFIG["slug"]
    jobs = [
        ("1-thumb", render_thumbnail),
        ("2-table", render_table),
        ("3-points-cta", render_points_cta),
    ]
    paths = []
    for name, fn in jobs:
        img = fn(CONFIG)
        p = f"{OUT_DIR}/{slug}-{name}.png"
        img.save(p, "PNG", optimize=True)
        paths.append(p)
        print("saved:", p, img.size)
    return paths


if __name__ == "__main__":
    main()
