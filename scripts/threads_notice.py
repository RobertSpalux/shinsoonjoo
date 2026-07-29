# -*- coding: utf-8 -*-
"""
스레드 필수안내사항 이미지 렌더
- 근거: 팜스 스레드 주의사항 ③ (글자수 제한 시 필수안내사항·유의문구만 이미지 게시 허용)
- ⚠️ 자구는 팜스 승인본 그대로. 오탈자처럼 보여도 수정 금지 (원안 변경 = 집중 모니터링 ②)
- 심의필: 제2026-07-8683호 (2026.07.29~2027.07.28)
"""
from PIL import Image, ImageDraw, ImageFont

W = 1080
PAD = 72
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

BG = (250, 247, 242)        # 웜 아이보리
INK = (46, 42, 38)          # 웜 차콜
GREEN = (27, 58, 48)        # 딥그린 #1b3a30
MUTED = (110, 102, 94)

f_h = ImageFont.truetype(FONT_B, 34, index=0)   # 섹션 헤더
f_b = ImageFont.truetype(FONT, 29, index=0)     # 본문
f_w = ImageFont.truetype(FONT_B, 29, index=0)   # 경고 강조
f_s = ImageFont.truetype(FONT, 27, index=0)     # 심의필

LH = 46          # 줄간
GAP_P = 18       # 문단 간격
GAP_S = 40       # 섹션 간격

# ── 승인본 자구 (수정 금지) ──────────────────────────────
BLOCK1_HEAD = "1. 본 내용은 모집종사자 개인의 의견이며, 계약체결에 따른 이익 또는 손실은 보험계약자 등에게 귀속됩니다."
BLOCK1_REST = [
    "보험사 상품별로 성별, 연령, 직업(급수)에 따라 가입가능한 담보와 가입금액, 보험료 등은 상이할 수 있습니다.",
    "보험사 상품별로 상이할 수 있으므로,관련한 세부사항은 반드시 약관을 참조 바랍니다.",
]
BLOCK2_HEAD = "2. 필수안내사항"
BLOCK2_PRE = [
    "신순주,손생보협회 등록번호 - 20030976050033",
    "본 광고는 광고심의기준을 준수하였으며, 유효기간은 심의일로부터 1년입니다.",
]
BLOCK2_WARN = [
    "보험계약자가 기존 보험계약을 해지하고 새로운 보험계약을 체결하는 과정에서",
    "① 질병이력, 연령증가 등으로 가입이 거절되거나 보험료가 인상될 수 있습니다.",
    "②가입 상품에 따라 새로운 면책기간 적용 및 보장 제한 등 기타 불이익이 발생할 수 있습니다.",
]
REVIEW = "프라임에셋 심의필 제2026-07-8683호 (2026.07.29~2027.07.28)"
# ────────────────────────────────────────────────────

def wrap(text, font, maxw, draw):
    """어절 단위 자동 줄바꿈. 원문 자구는 보존하고 줄만 나눈다."""
    words = text.split(" ")
    lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= maxw:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

tmp = Image.new("RGB", (10, 10))
d0 = ImageDraw.Draw(tmp)
CW = W - PAD * 2          # 본문 폭
WARN_IND = 26             # 경고 블록 좌측 들여쓰기(바 공간)

# ── 레이아웃 사전 계산 ──
plan = []   # (kind, lines, font, color)
plan.append(("p", wrap(BLOCK1_HEAD, f_b, CW, d0), f_b, INK))
for t in BLOCK1_REST:
    plan.append(("p", wrap(t, f_b, CW, d0), f_b, INK))
plan.append(("s", [BLOCK2_HEAD], f_h, GREEN))
for t in BLOCK2_PRE:
    plan.append(("p", wrap(t, f_b, CW, d0), f_b, INK))
for t in BLOCK2_WARN:
    plan.append(("w", wrap(t, f_w, CW - WARN_IND, d0), f_w, GREEN))
plan.append(("r", [REVIEW], f_s, MUTED))

H = PAD
for kind, lines, font, _ in plan:
    if kind == "s":
        H += GAP_S
    if kind == "r":
        H += GAP_S
    H += LH * len(lines) + GAP_P
H += PAD - GAP_P

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 상단 딥그린 헤어라인
d.rectangle([0, 0, W, 8], fill=GREEN)

y = PAD
for kind, lines, font, color in plan:
    if kind in ("s", "r"):
        y += GAP_S
    if kind == "w":
        bar_top = y + 6
        bar_bot = y + LH * len(lines) - 6
        d.rectangle([PAD, bar_top, PAD + 5, bar_bot], fill=GREEN)
    for ln in lines:
        x = PAD + (WARN_IND if kind == "w" else 0)
        d.text((x, y), ln, font=font, fill=color)
        y += LH
    y += GAP_P

img.save("/home/claude/threads_notice_8683.png")
print(f"size = {W} x {H}  ratio = 1:{H/W:.2f}")
