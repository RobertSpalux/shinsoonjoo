# -*- coding: utf-8 -*-
"""
스레드 필수안내사항 이미지 렌더

    python scripts/threads_notice.py --review-no 2026-09-7550 --from 2026.09.29 --to 2027.09.28 --out <png>
    python scripts/threads_notice.py --review-no 2026-07-8683 --from 2026.07.29 --to 2027.07.28 --out <png>

- 근거: 팜스 스레드 주의사항 ③ (글자수 제한 시 필수안내사항·유의문구만 이미지 게시 허용)
- ⚠️ 자구는 **팜스 스레드 자동생성 승인본** 그대로(CLAUDE.md §6.3 — brand.ts 자구와 다르다. 덮어쓰지 않는다).
  오탈자처럼 보여도 수정 금지 (원안 변경 = 집중 모니터링 ②)
- **심의필 줄만 인자.** 나머지 자구는 8683호(2026.07.29) 승인본 그대로다. 7550호도 같은 자구(2026-09-29 관제탑 판정).
  ⚠️ 게시 전 반드시 해당 심의필의 PAMS 첨부 이미지와 글자 단위로 대조한다(--dump 로 줄 목록을 뽑아 비교).
- 폰트: 관제탑(리눅스) Noto Sans CJK .ttc 를 우선 쓰고, 없으면 Windows Noto Sans KR 가변폰트.
  글리프는 미세하게 다를 수 있으나 자구(글자)는 같다.
"""
import argparse
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

W = 1080
PAD = 72
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
WIN_VF = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "NotoSansKR-VF.ttf")


def font(bold, size):
    path = FONT_B if bold else FONT
    if os.path.exists(path):
        return ImageFont.truetype(path, size, index=0)
    f = ImageFont.truetype(WIN_VF, size)
    f.set_variation_by_name(b"Bold" if bold else b"Regular")
    return f


BG = (250, 247, 242)        # 웜 아이보리
INK = (46, 42, 38)          # 웜 차콜
GREEN = (27, 58, 48)        # 딥그린 #1b3a30
MUTED = (110, 102, 94)

f_h = font(True, 34)    # 섹션 헤더
f_b = font(False, 29)   # 본문
f_w = font(True, 29)    # 경고 강조
f_s = font(False, 27)   # 심의필

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
# 심의필 줄 — 8683호 승인본 형식 「프라임에셋 심의필 제{번호}호 ({시작}~{끝})」(호 뒤 공백 1칸). 번호·기간만 인자.
REVIEW_FMT = "프라임에셋 심의필 제{no}호 ({frm}~{to})"
NO_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-\d{4,5}$")
DATE_RE = re.compile(r"^\d{4}\.\d{2}\.\d{2}$")

ap = argparse.ArgumentParser()
ap.add_argument("--review-no", required=True, help="번호만. 예: 2026-09-7550")
ap.add_argument("--from", dest="frm", required=True, help="YYYY.MM.DD")
ap.add_argument("--to", required=True, help="YYYY.MM.DD")
ap.add_argument("--out", required=True, help="PNG 경로")
ap.add_argument("--dump", help="이미지에 들어간 줄 목록(대조용 txt)")
args = ap.parse_args()
if not NO_RE.match(args.review_no):
    sys.exit(f"심의필 번호는 번호만(YYYY-MM-NNNN): {args.review_no!r}")
if not (DATE_RE.match(args.frm) and DATE_RE.match(args.to)):
    sys.exit("유효기간은 YYYY.MM.DD 형식")
REVIEW = REVIEW_FMT.format(no=args.review_no, frm=args.frm, to=args.to)
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

# ── 줄바꿈 고정 — 8683호 스레드 게시본(2026-07-29) 실측 그대로 ──────────
# 폰트(관제탑 CJK .ttc ↔ Windows KR VF)에 따라 폭이 몇 px 달라 자동 줄바꿈이 흔들린다
# (실측: 「…심의일로부터 1년입니다.」가 VF 에서 3px 넘쳐 두 줄이 됐다). 그래서 게시본 줄바꿈을 고정한다.
LAYOUT = {
    BLOCK1_HEAD: ["1. 본 내용은 모집종사자 개인의 의견이며, 계약체결에 따른 이익 또는 손실은",
                  "보험계약자 등에게 귀속됩니다."],
    BLOCK1_REST[0]: ["보험사 상품별로 성별, 연령, 직업(급수)에 따라 가입가능한 담보와 가입금액,",
                     "보험료 등은 상이할 수 있습니다."],
    BLOCK1_REST[1]: ["보험사 상품별로 상이할 수 있으므로,관련한 세부사항은 반드시 약관을 참조",
                     "바랍니다."],
    BLOCK2_PRE[1]: ["본 광고는 광고심의기준을 준수하였으며, 유효기간은 심의일로부터 1년입니다."],
    BLOCK2_WARN[0]: ["보험계약자가 기존 보험계약을 해지하고 새로운 보험계약을 체결하는", "과정에서"],
    BLOCK2_WARN[1]: ["① 질병이력, 연령증가 등으로 가입이 거절되거나 보험료가 인상될 수", "있습니다."],
    BLOCK2_WARN[2]: ["②가입 상품에 따라 새로운 면책기간 적용 및 보장 제한 등 기타 불이익이",
                     "발생할 수 있습니다."],
}
for _src, _lines in LAYOUT.items():  # 고정 줄을 이으면 원문과 글자 하나까지 같아야 한다
    assert " ".join(_lines) == _src, f"줄 고정이 자구를 바꿨다: {_src}"


def lines_of(text, font, maxw, draw):
    return LAYOUT.get(text) or wrap(text, font, maxw, draw)


# ── 레이아웃 사전 계산 ──
plan = []   # (kind, lines, font, color)
plan.append(("p", lines_of(BLOCK1_HEAD, f_b, CW, d0), f_b, INK))
for t in BLOCK1_REST:
    plan.append(("p", lines_of(t, f_b, CW, d0), f_b, INK))
plan.append(("s", [BLOCK2_HEAD], f_h, GREEN))
for t in BLOCK2_PRE:
    plan.append(("p", lines_of(t, f_b, CW, d0), f_b, INK))
for t in BLOCK2_WARN:
    plan.append(("w", lines_of(t, f_w, CW - WARN_IND, d0), f_w, GREEN))
plan.append(("r", [REVIEW], f_s, MUTED))

for kind, lines, font, _ in plan:  # 고정 줄이 폰트 차이로 넘쳐도 오른쪽 여백 절반 안이어야 한다
    for ln in lines:
        x0 = PAD + (WARN_IND if kind == "w" else 0)
        if x0 + d0.textlength(ln, font=font) > W - PAD // 2:
            sys.exit(f"줄이 이미지 폭을 넘는다: {ln}")

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

os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
img.save(args.out)
print(f"saved: {args.out}  size = {W} x {H}  ratio = 1:{H/W:.2f}")
if args.dump:
    # 자구 대조용 — 줄바꿈 전 원문 문장 단위(렌더 폰트와 무관)
    src = [BLOCK1_HEAD, *BLOCK1_REST, BLOCK2_HEAD, *BLOCK2_PRE, *BLOCK2_WARN, REVIEW]
    with open(args.dump, "w", encoding="utf-8") as fp:
        shown = [" | ".join(lines) for _, lines, _, _ in plan]  # 실제 이미지 줄바꿈( | = 줄바꿈)
        fp.write("\n".join(src) + "\n\n# 이미지 줄바꿈\n" + "\n".join(shown) + "\n")
    print(f"dump: {args.dump}")
