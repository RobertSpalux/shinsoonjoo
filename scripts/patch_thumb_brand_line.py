#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
승인 썸네일의 하단 브랜드 줄 **한 줄만** 바꿔 쓴다 — 나머지 픽셀은 승인 원본 그대로.

    python scripts/patch_thumb_brand_line.py <slug> <심의필번호>

왜 재렌더가 아니라 패치인가:
  naver_images.py 는 관제탑(리눅스)의 Noto Sans CJK .ttc 로 렌더됐다. 이 PC에는 그 폰트가 없고
  Windows 의 Noto Sans KR 가변폰트뿐이라, 통째로 다시 그리면 제목·부제의 글리프가 승인본과
  미세하게 달라진다. 심의 조건은 「GA 명장」 자리의 기간 명시뿐이므로, 그 줄만 지우고 다시 쓴다.

입력: assets/naver/<slug>/<slug>-1-thumb.png (팜스 제출 원본, 수정하지 않는다)
출력: assets/naver/<slug>/<심의필번호>/<slug>-1-thumb.png
검증: 옛 문구를 같은 위치에 그렸을 때 원본과의 오차를 출력한다(보정값이 맞는지 확인용).
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ga_master  # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = "C:/Windows/Fonts/NotoSansKR-VF.ttf"
BG = (27, 58, 48)          # FOREST(#1b3a30) 실측 픽셀
FILL = "#a9bfb5"           # naver_images.py 브랜드 서브 줄 색
SIZE = 21                  # naver_images.py sans("regular", 21)
X, Y_FROM_BOTTOM = 72, 84  # naver_images.py (pad, H - 84)
DX, DY = -1, 4             # CJK .ttc ↔ KR VF 기준선 보정(원본 대조로 실측, 2026-09-28)
ERASE = (60, 713, 740, 752)  # 브랜드 서브 줄만 덮는 영역(윗줄 「신순주의 선한 금융」은 686~712)
OLD = "23년 차 GA명장 · 보험 리모델링"  # 5호까지 승인본 자구 — 보정 검증에만 쓴다


def font():
    f = ImageFont.truetype(FONT, SIZE)
    f.set_variation_by_name(b"Regular")
    return f


def main():
    if len(sys.argv) < 3:
        raise SystemExit("사용법: python scripts/patch_thumb_brand_line.py <slug> <심의필번호>")
    slug, review_no = sys.argv[1], sys.argv[2]
    src = os.path.join(ROOT, "assets", "naver", slug, f"{slug}-1-thumb.png")
    im = Image.open(src).convert("RGB")
    W, H = im.size
    pos = (X + DX, H - Y_FROM_BOTTOM + DY)
    f = font()

    # 보정 검증 — 옛 문구를 그려 원본 줄과 비교
    probe = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(probe).text(pos, OLD, font=f, fill=FILL)
    diff = ImageChops.difference(im.crop(ERASE), probe.crop(ERASE)).convert("L")
    print(f"보정 검증(옛 문구 vs 원본): 평균 오차 {ImageStat.Stat(diff).mean[0]:.2f}/255")

    new_line = f"23년 차 {ga_master.load_label()} · 보험 리모델링"
    out = im.copy()
    d = ImageDraw.Draw(out)
    d.rectangle(ERASE, fill=BG)
    d.text(pos, new_line, font=f, fill=FILL)
    right = pos[0] + d.textbbox((0, 0), new_line, font=f)[2]
    if right > ERASE[2]:
        raise SystemExit(f"새 줄이 영역을 넘는다(right={right})")

    changed = ImageChops.difference(im, out).getbbox()
    if changed and (changed[1] < ERASE[1] or changed[3] > ERASE[3]):
        raise SystemExit(f"브랜드 줄 밖의 픽셀이 바뀌었다: {changed}")

    dst_dir = os.path.join(ROOT, "assets", "naver", slug, review_no)
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, f"{slug}-1-thumb.png")
    out.save(dst, "PNG", optimize=True)
    print(f"새 줄: {new_line}")
    print(f"바뀐 영역: {changed} (브랜드 줄 {ERASE[1]}~{ERASE[3]} 안)")
    print("saved:", dst)


if __name__ == "__main__":
    main()
