#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
신순주의 선한 금융 — 인스타 카드뉴스 렌더러 v2 (1080x1350)
확정 리듬(A안): 오버라인 → 제목(상단) → 구분선 → 근거·수치 → 알약 → 출처 → 브랜드
업그레이드: 그라디언트 배경 / 카드전용 밝은 골드 / 채운 알약 / 행 그림자 / 미세 노이즈
안전장치: draw_bignum() 이 쉼표 꼬리까지 실측해 다음 요소 y를 반환 (겹침 원천 차단)

다음 글에 쓸 때는 CONTENT 딕셔너리만 교체한다.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, random

W, H = 1080, 1350
PAD = 84
OUT = "/home/claude/work/insta_v2"
SLUG = "manual-therapy-2026-july"

# ── 팔레트 ────────────────────────────────────────
FOREST_TOP, FOREST_BOT = "#20463a", "#0f2419"   # 딥그린 그라디언트
CREAM_TOP, CREAM_BOT = "#fdfcfa", "#f1ece1"     # 크림 그라디언트
ROW = "#2b5546"          # 딥그린 위 행/알약
ROW_SH = "#0c1f16"       # 행 그림자
GOLD_BRIGHT = "#e3b23c"  # 카드 전용 (어두운 배경)
GOLD = "#a8842c"         # 기존 골드 (밝은 배경)
CREAM = "#faf9f6"
ON_DARK = "#9fb8ac"
ON_DARK_DIM = "#7d9a8e"
STRONG = "#1c1813"
BODY = "#48423a"
MUTED = "#6b6457"
LINE_DARK = "#3a6553"
LINE_LT = "#e2dbcd"
CARD_LT = "#ffffff"
CARD_LT_SH = "#e6dfd1"

FD = "/usr/share/fonts/opentype/noto"


def _kr(p):
    for i in range(12):
        try:
            f = ImageFont.truetype(p, 20, index=i)
            if "KR" in " ".join(f.getname()):
                return i
        except Exception:
            break
    return 0


_S = {k: f"{FD}/NotoSansCJK-{v}.ttc" for k, v in
      {"black": "Black", "bold": "Bold", "medium": "Medium", "regular": "Regular"}.items()}
_I = {p: _kr(p) for p in _S.values()}


def sans(w, s):
    return ImageFont.truetype(_S[w], s, index=_I[_S[w]])


def tw(d, s, f):
    b = d.textbbox((0, 0), s, font=f)
    return b[2] - b[0]


def _hx(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def grad(top, bot):
    t, b = _hx(top), _hx(bot)
    im = Image.new("RGB", (1, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        r = y / H
        d.point((0, y), fill=tuple(int(t[i] + (b[i] - t[i]) * r) for i in range(3)))
    return im.resize((W, H))


def noise(img, amt=5):
    n = Image.new("L", (W // 2, H // 2))
    px = n.load()
    for y in range(H // 2):
        for x in range(W // 2):
            px[x, y] = random.randint(128 - amt, 128 + amt)
    n = n.resize((W, H)).filter(ImageFilter.GaussianBlur(0.4))
    return Image.blend(img, Image.merge("RGB", (n, n, n)), 0.05)


def canvas(dark):
    img = noise(grad(FOREST_TOP, FOREST_BOT) if dark else grad(CREAM_TOP, CREAM_BOT),
                5 if dark else 3)
    d = ImageDraw.Draw(img)
    d.rectangle([(0, 0), (W, 10)], fill=GOLD_BRIGHT if dark else GOLD)
    return img, d


def overline(d, text, dark):
    d.line([(PAD, PAD + 16), (PAD + 44, PAD + 16)],
           fill=GOLD_BRIGHT if dark else GOLD, width=3)
    d.text((PAD + 62, PAD), text, font=sans("bold", 30),
           fill=ON_DARK if dark else MUTED)


def pill(d, x, y, text, dark, solid=False, fs=30):
    """solid=True면 골드로 채운 강조 알약(배지)"""
    f = sans("black", fs)
    w = tw(d, text, f)
    if solid:
        bg, fg = (GOLD_BRIGHT, "#2a2005") if dark else ("#1b3a30", CREAM)
    else:
        bg, fg = (ROW, CREAM) if dark else ("#eae4d8", STRONG)
    d.rounded_rectangle([(x, y), (x + w + 60, y + fs + 34)],
                        radius=(fs + 34) // 2, fill=bg)
    d.text((x + 30, y + 16), text, font=f, fill=fg)
    return x + w + 60


def title(d, lines, y, dark, size=88, lh=110):
    """lines = [(문구, 강조여부)]"""
    f = sans("black", size)
    for i, (t, hi) in enumerate(lines):
        col = (GOLD_BRIGHT if dark else GOLD) if hi else (CREAM if dark else STRONG)
        d.text((PAD, y + i * lh), t, font=f, fill=col)
    return y + len(lines) * lh


def rule(d, y, dark, full=True):
    x2 = (W - PAD) if full else (PAD + 64)
    d.line([(PAD, y), (x2, y)], fill=LINE_DARK if dark else LINE_LT,
           width=2 if full else 4)
    return y


def draw_bignum(d, x, y, num, f_num, unit=None, f_unit=None, dark=True, gap=42):
    """쉼표 꼬리까지 실측 → 다음 요소 안전 y 반환 (겹침 방지 핵심)"""
    col = GOLD_BRIGHT if dark else GOLD
    d.text((x, y), num, font=f_num, fill=col)
    b = d.textbbox((x, y), num, font=f_num)
    if unit and f_unit:
        digits_bottom = d.textbbox((x, y), num.replace(",", "").replace("·", ""),
                                   font=f_num)[3]
        ub = d.textbbox((0, 0), unit, font=f_unit)
        d.text((b[2] + 22, digits_bottom - (ub[3] - ub[1]) - ub[1]), unit,
               font=f_unit, fill=CREAM if dark else STRONG)
    return b[3] + gap


def source(d, y, text, dark):
    d.text((PAD, y), text, font=sans("regular", 28),
           fill=ON_DARK_DIM if dark else MUTED)


def footer(d, dark, page=None, nav=None):
    f, fs = sans("bold", 28), sans("regular", 26)
    y = H - 72
    d.text((PAD, y), "신순주의 선한 금융", font=f, fill=CREAM if dark else STRONG)
    d.text((PAD + tw(d, "신순주의 선한 금융", f) + 16, y + 2), "· goodfinance.kr",
           font=fs, fill=ON_DARK if dark else MUTED)
    if nav:
        nf = sans("bold", 29)
        d.text((W - PAD - tw(d, nav, nf), y), nav, font=nf,
               fill=GOLD_BRIGHT if dark else GOLD)
    if page:
        pf = sans("bold", 27)
        d.text((W - PAD - tw(d, page, pf), y), page, font=pf,
               fill=ON_DARK if dark else MUTED)


# ══════════════════════════════════════════════════
# CONTENT — 다음 글에는 여기만 교체
# ══════════════════════════════════════════════════
C = {
    "overline": "2026년 7월 · 실손보험",
    "source": "보건복지부 건강보험정책심의위원회 확정 기준",
}


# 1 ─ 커버
def card1():
    img, d = canvas(True)
    overline(d, C["overline"], True)
    title(d, [("도수치료,", False), ("7월부터 이렇게", False), ("바뀝니다", True)],
          196, True, 92, 112)
    y = rule(d, 560, True) + 40
    d.text((PAD, y), "횟수 기준이 생겼습니다", font=sans("bold", 34), fill=ON_DARK)
    y = draw_bignum(d, PAD - 8, y + 62, "주 2회", sans("black", 186),
                    "· 연 15회", sans("black", 70), True, 40)
    d.text((PAD, y), "물리치료 먼저 · 본인부담 정률", font=sans("medium", 36), fill=ON_DARK)
    y += 100
    x = pill(d, PAD, y, "피로회복 목적 제외", True)
    pill(d, x + 16, y, "소진해도 비용청구 불가", True)
    source(d, y + 98, "보건복지부 확정 기준", True)
    footer(d, True, nav="→ 넘겨보기")
    return img


# 2 ─ 문제
def card2():
    img, d = canvas(False)
    overline(d, "왜 바뀌었나", False)
    title(d, [("같은 도수치료인데", False), ("가격이 병원마다 달랐습니다", True)],
          200, False, 74, 96)
    y = rule(d, 430, False) + 44
    d.text((PAD, y), "이전 병원별 가격", font=sans("bold", 34), fill=MUTED)
    # 빅넘버(금액) 제거 → 문장형 2줄. draw_bignum 반환 y에 의존하지 않으므로
    # 아래 요소는 여기서 산출한 y를 그대로 이어받는다.
    by = y + 56
    fbig = sans("black", 116)
    d.text((PAD, by), "기준이", font=fbig, fill=STRONG)
    d.text((PAD, by + 132), "없었습니다", font=fbig, fill="#1b3a30")
    y = by + 132 + 150
    d.text((PAD, y), "병원마다 조건이 달랐습니다", font=sans("medium", 36), fill=BODY)
    y += 110
    d.text((PAD, y), "그래서 정부가", font=sans("black", 52), fill=STRONG)
    d.text((PAD, y + 72), "기준을 정했습니다", font=sans("black", 52), fill="#1b3a30")
    source(d, y + 190, C["source"], False)
    footer(d, False, page="2 / 7")
    return img


# 3 ─ 표 (저장 유도)
def card3():
    img, d = canvas(True)
    pill(d, PAD, PAD - 6, "저장 필수", True, solid=True)
    title(d, [("무엇이 달라졌나", False)], 208, True, 82)
    top = 350
    d.text((PAD + 320, top), "이전", font=sans("bold", 28), fill=ON_DARK)
    d.text((PAD + 620, top), "2026년 7월~", font=sans("bold", 28), fill=GOLD_BRIGHT)
    ry, rh = top + 56, 122
    rows = [("가격 기준", "병원별", "전국 동일"), ("본인부담", "전액", "95%"),
            ("횟수", "제한 없음", "주2 · 연15"), ("시작", "바로 가능", "물리치료 후")]
    fl, fb, fa = sans("bold", 38), sans("regular", 34), sans("black", 42)
    for lab, bef, aft in rows:
        d.rounded_rectangle([(PAD - 16, ry + 5), (W - PAD + 16, ry + rh - 9)],
                            radius=18, fill=ROW_SH)
        d.rounded_rectangle([(PAD - 18, ry), (W - PAD + 14, ry + rh - 14)],
                            radius=18, fill=ROW)
        d.text((PAD + 8, ry + 34), lab, font=fl, fill=CREAM)
        d.text((PAD + 320, ry + 38), bef, font=fb, fill=ON_DARK)
        d.text((PAD + 620, ry + 32), aft, font=fa, fill=GOLD_BRIGHT)
        ry += rh
    source(d, ry + 26, C["source"], True)
    footer(d, True, page="3 / 7")
    return img


# 4 ─ 횟수
def card4():
    img, d = canvas(False)
    overline(d, "이제 횟수가 정해졌습니다", False)
    title(d, [("여기까지만", False), ("인정됩니다", True)], 200, False, 84, 104)
    y = rule(d, 450, False) + 50
    y = draw_bignum(d, PAD - 8, y, "주2 · 연15", sans("black", 118),
                    "회", sans("black", 54), False, 44)
    d.text((PAD, y), "수술·골절 등 뚜렷한 의학적 사유가 있으면",
           font=sans("medium", 36), fill=BODY)
    d.text((PAD, y + 56), "연 최대 24회까지 가능합니다", font=sans("medium", 36), fill=BODY)
    y += 150
    # "이월 없음"은 원문 미확인(§6.10) → 제거. "올해는 7~12월 기준"만 유지.
    pill(d, PAD, y, "올해는 7~12월 기준", False)
    source(d, y + 100, C["source"], False)
    footer(d, False, page="4 / 7")
    return img


# 5 ─ 선행 조건
def card5():
    img, d = canvas(True)
    overline(d, "바로 받을 수 없습니다", True)
    title(d, [("먼저 물리치료를", False), ("받아야 합니다", True)], 200, True, 86, 106)
    y = rule(d, 470, True) + 50
    y = draw_bignum(d, PAD - 8, y, "2주 · 4회", sans("black", 132),
                    "이상", sans("black", 52), True, 44)
    d.text((PAD, y), "그래도 호전이 없다는 의학적 판단이 있어야", font=sans("medium", 36), fill=ON_DARK)
    d.text((PAD, y + 56), "도수치료를 시작할 수 있습니다", font=sans("medium", 36), fill=ON_DARK)
    y += 150
    pill(d, PAD, y, "피로회복 · 체형교정 목적은 제외", True, solid=True, fs=28)
    source(d, y + 100, "건강보험 · 실손 모두 적용되지 않습니다", True)
    footer(d, True, page="5 / 7")
    return img


# 6 ─ 반전 (우리만의 관점)
def card6():
    img, d = canvas(False)
    pill(d, PAD, PAD - 6, "여기가 제일 중요합니다", False, solid=True)
    title(d, [("5세대 실손,", False), ("이미 나왔습니다", True)], 210, False, 86, 106)
    y = 452
    d.text((PAD, y), "2026년 5월 6일 출시 · 16개 보험사",
           font=sans("medium", 38), fill=BODY)
    by = y + 90
    d.rounded_rectangle([(PAD - 16, by + 6), (W - PAD + 16, by + 206)],
                        radius=20, fill=CARD_LT_SH)
    d.rounded_rectangle([(PAD - 18, by), (W - PAD + 14, by + 200)],
                        radius=20, fill=CARD_LT)
    d.text((PAD + 16, by + 36), "도수치료는", font=sans("black", 48), fill=STRONG)
    d.text((PAD + 16, by + 108), "기본 보장에서 제외", font=sans("black", 48), fill="#1b3a30")
    y = by + 260
    d.text((PAD, y), "보험료가 반값이 된다는 말만 듣고", font=sans("medium", 36), fill=BODY)
    d.text((PAD, y + 56), "옮기시면 자주 쓰던 치료가 빠집니다.", font=sans("medium", 36), fill=BODY)
    source(d, y + 150, "특약 가입 시에도 자기부담률·한도가 달라집니다", False)
    footer(d, False, page="6 / 7")
    return img


# 7 ─ CTA
def card7():
    img, d = canvas(True)
    overline(d, "확인해보셨나요", True)
    title(d, [("내 실손,", False), ("몇 세대인지", False), ("알고 계신가요?", True)],
          200, True, 88, 110)
    y = rule(d, 560, True) + 46
    d.text((PAD, y), "자주 쓰는 담보가 무엇인지 알아야", font=sans("medium", 38), fill=ON_DARK)
    d.text((PAD, y + 58), "바꿀지 둘지 판단이 섭니다.", font=sans("medium", 38), fill=ON_DARK)
    y += 160
    d.text((PAD, y), "담보 단위 리모델링 진단", font=sans("black", 56), fill=CREAM)
    d.text((PAD, y + 88), "goodfinance.kr/diagnosis", font=sans("bold", 42), fill=GOLD_BRIGHT)
    y += 176
    pill(d, PAD, y, "프로필 링크에서 바로", True, solid=True, fs=28)
    footer(d, True, page="7 / 7")
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    for i, fn in enumerate([card1, card2, card3, card4, card5, card6, card7], 1):
        p = f"{OUT}/{SLUG}-v2-{i:02d}.png"
        fn().save(p, "PNG", optimize=True)
        print("saved:", p)


if __name__ == "__main__":
    main()
