# -*- coding: utf-8 -*-
"""거대 숫자 안전 렌더 헬퍼 — 쉼표/받침 꼬리 충돌 방지 (전 카드 공용)"""
from PIL import ImageDraw

def draw_bignum(d, x, y, num, font_num, unit=None, font_unit=None,
                color="#e3b23c", unit_color="#faf9f6", gap_below=44):
    """
    숫자를 그리고, '다음 요소를 놓아도 안전한 y좌표'를 반환한다.
    bbox 하단(쉼표 꼬리 포함)을 실측하므로 폰트 크기를 바꿔도 안 겹친다.
    """
    d.text((x, y), num, font=font_num, fill=color)
    b = d.textbbox((x, y), num, font=font_num)   # (x0, y0, x1, y1)
    if unit and font_unit:
        ub = d.textbbox((0, 0), unit, font=font_unit)
        uh = ub[3] - ub[1]
        # 단위는 숫자 baseline 근처에 정렬 (아래 꼬리는 무시)
        digits_bottom = d.textbbox((x, y), num.replace(",", ""), font=font_num)[3]
        d.text((b[2] + 22, digits_bottom - uh - ub[1]), unit,
               font=font_unit, fill=unit_color)
    return b[3] + gap_below
