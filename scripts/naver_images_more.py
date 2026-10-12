#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
네이버 이미지 5장 틀 — naver_images.py 3종(썸네일·비교표·포인트+CTA)에 정보 도식 2종(대비·흐름)을 더한다.
WRITING-SPEC §4-4 규칙 6(제작 이미지 5~7장) · 충돌표 6(늘리는 이미지는 제도·담보 구조 도식만).

    NAVER_FONT_DIR=<Noto CJK 6종> python scripts/naver_images_more.py <slug> <출력 폴더>

config = configs/<slug>.json (naver_images.py 필수 키 + contrast_* · flow_*).
출력 = <slug>-1-thumb / 2-table / 3-contrast / 4-flow / 5-points-cta .png (800×800)
⚠️ naver_images.py 운영 규칙 그대로 — config·이 스크립트·제출에 쓴 PNG(assets/naver/<slug>/)를 커밋한다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import naver_images as ni  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

MORE_KEYS = ["contrast_title", "contrast", "contrast_note", "flow_title", "flow", "flow_note"]
H = 800


def _note(d, text, pad):
    f = ni.sans("regular", 21)
    nb = d.multiline_textbbox((0, 0), text, font=f, spacing=6)
    d.multiline_text((pad, H - 28 - (nb[3] - nb[1])), text, font=f, fill=ni.TEXT_MUTED, spacing=6)
    return H - 28 - (nb[3] - nb[1])


def _fit(d, s, f, max_w, max_lines, where):
    lines = ni.wrap(d, s, f, max_w)
    if len(lines) > max_lines or any(ni.text_w(d, ln, f) > max_w for ln in lines):
        raise SystemExit(f"[칸 넘침] {where}: 「{s}」 — {len(lines)}줄(최대 {max_lines}). 글자를 줄이세요")
    return lines


def render_contrast(cfg):
    """두 칸 대비 — 왼쪽(크림 테두리) vs 오른쪽(딥그린 면). contrast = [[머리, 본문], [머리, 본문]]."""
    img = Image.new("RGB", (ni.W, H), ni.CREAM)
    d = ImageDraw.Draw(img)
    pad = 64
    d.text((pad, pad + 8), cfg["contrast_title"], font=ni.serif("bold", 44), fill=ni.TEXT_STRONG)
    d.line([(pad, pad + 78), (pad + 40, pad + 78)], fill=ni.GOLD, width=2)
    top, gap = pad + 130, 24
    box_w = (ni.W - pad * 2 - gap) // 2
    note_top = _note(d, cfg["contrast_note"], pad)
    bottom = note_top - 32
    f_head, f_body = ni.sans("bold", 30), ni.sans("medium", 25)
    for i, (head, body) in enumerate(cfg["contrast"]):
        x0 = pad + i * (box_w + gap)
        if i == 0:
            d.rectangle([(x0, top), (x0 + box_w, bottom)], fill=ni.WHITE, outline=ni.LINE, width=2)
            hc, bc = ni.TEXT_STRONG, ni.TEXT_BODY
        else:
            d.rectangle([(x0, top), (x0 + box_w, bottom)], fill=ni.FOREST)
            hc, bc = ni.CREAM, "#c9d6cf"
        inner = box_w - 56
        y = top + 36
        for ln in _fit(d, head, f_head, inner, 2, f"contrast[{i}] 머리"):
            d.text((x0 + 28, y), ln, font=f_head, fill=hc)
            y += 42
        d.line([(x0 + 28, y + 10), (x0 + 60, y + 10)], fill=ni.GOLD, width=2)
        y += 34
        for ln in _fit(d, body, f_body, inner, 8, f"contrast[{i}] 본문"):
            d.text((x0 + 28, y), ln, font=f_body, fill=bc)
            y += 38
        if y > bottom - 16:
            raise SystemExit(f"[칸 넘침] contrast[{i}] 본문이 상자 아래로 나간다 — 줄이세요")
    return img


def render_flow(cfg):
    """흐름 — 번호 원 + 세로 연결선. flow = [[머리, 설명], ...] 3~4단계."""
    img = Image.new("RGB", (ni.W, H), ni.CREAM_SOFT)
    d = ImageDraw.Draw(img)
    pad = 64
    d.text((pad, pad + 8), cfg["flow_title"], font=ni.serif("bold", 42), fill=ni.TEXT_STRONG)
    d.line([(pad, pad + 76), (pad + 40, pad + 76)], fill=ni.GOLD, width=2)
    note_top = _note(d, cfg["flow_note"], pad)
    steps = cfg["flow"]
    top = pad + 128
    step_h = (note_top - 30 - top) // len(steps)
    f_num, f_head, f_body = ni.sans("bold", 26), ni.sans("bold", 29), ni.sans("regular", 24)
    cx, r = pad + 24, 22
    for i, (head, body) in enumerate(steps):
        y = top + i * step_h
        if i < len(steps) - 1:
            d.line([(cx, y + r * 2), (cx, y + step_h)], fill=ni.LINE, width=2)
        d.ellipse([(cx - r, y), (cx + r, y + r * 2)], fill=ni.FOREST)
        n = str(i + 1)
        d.text((cx - ni.text_w(d, n, f_num) / 2, y + 5), n, font=f_num, fill=ni.CREAM)
        x = pad + 72
        d.text((x, y + 2), _fit(d, head, f_head, ni.W - x - pad, 1, f"flow[{i}] 머리")[0], font=f_head, fill=ni.TEXT_STRONG)
        for j, ln in enumerate(_fit(d, body, f_body, ni.W - x - pad, 2, f"flow[{i}] 설명")):
            d.text((x, y + 46 + j * 34), ln, font=f_body, fill=ni.TEXT_MUTED)
    return img


def main():
    if len(sys.argv) < 3:
        raise SystemExit("사용법: python scripts/naver_images_more.py <slug> <출력 폴더>")
    slug, out = sys.argv[1], sys.argv[2]
    cfg = ni.load_config(slug)
    miss = [k for k in MORE_KEYS if k not in cfg]
    if miss:
        raise SystemExit(f"[config 키 누락] {slug}.json — 5장 틀 필수 키 없음: {', '.join(miss)}")
    ni.check_fonts()
    os.makedirs(out, exist_ok=True)
    jobs = [("1-thumb", ni.render_thumbnail), ("2-table", ni.render_table), ("3-contrast", render_contrast),
            ("4-flow", render_flow), ("5-points-cta", ni.render_points_cta)]
    for name, fn in jobs:
        p = os.path.join(out, f"{slug}-{name}.png")
        fn(cfg).save(p, "PNG", optimize=True)
        print("saved:", p)


if __name__ == "__main__":
    main()
