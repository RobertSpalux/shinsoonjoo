#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
이미지 생성 스크립트의 '금액 노출' 게이트 (CLAUDE.md §6.10 준수).

§6.10 [제목·대표이미지 — 반려 확정]:
  - 보험료·보장금액·보험금·환급률 노출 금지("O만원" 등 단위 유추 가능한 표현도 불가)
  - 금액 일부만 노출해도 자릿수가 확인되면 금액 노출로 간주
  - 화폐 기호(₩, $) 노출 금지

카드/네이버 이미지는 심의 대상 광고물의 대표 이미지에 해당하므로,
렌더 스크립트에 금액 리터럴이 들어가면 심의 반려 사유가 된다.
이 검사기는 렌더 스크립트의 '문자열 리터럴'만 AST로 골라 금액 패턴을 검사한다.
(주석·정규식이 아니라 실제로 화면에 찍히는 리터럴 단위로 검사한다.)

사용:
  python scripts/check_image_money.py            # 기본 TARGETS 전수 검사
  python scripts/check_image_money.py a.py b.py  # 지정 파일만 검사
위반이 하나라도 있으면 exit 1.
"""
import ast
import os
import re
import sys

# Windows 콘솔(cp949)에서도 한글·기호가 깨지지 않도록 UTF-8로 강제한다.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ── 검사 대상 (레포 루트 기준, 이미지 생성 스크립트) ──────────────
# ⚠️ 이 검사기 자신(check_image_money.py)은 금액 패턴 리터럴을 예시로 담고
#    있으므로 대상에 넣지 않는다.
TARGETS = [
    "insta_cards_v2.py",
    "naver_images.py",
    "cover_variants.py",
    "bignum.py",
]

# ── 오탐 예외 (리터럴 전문 완전일치만 허용) ──────────────────────
# 인라인 주석으로 무시하지 않는다. 예외는 반드시 여기에 명시한다.
ALLOWLIST = set()

# ── 금액 판정 패턴 ────────────────────────────────────────────────
# 1) 세 자리 콤마 숫자: 43,850 / 5,000 / 41,658
RE_COMMA = re.compile(r"\d{1,3}(?:,\d{3})+")
# 2) 숫자 뒤 한국어 금액 단위: 원 / 만원 / 만 / 억 / 천만 / 백만
#    (숫자가 앞에 있어야 하므로 '정말'·'얼마' 같은 일반어의 '만'은 걸리지 않는다)
RE_KRW_UNIT = re.compile(r"\d\s*(?:억|천만|백만|만원|만|원)")
# 3) 화폐 기호
RE_SYMBOL = re.compile(r"[₩$]")

PATTERNS = [
    ("콤마 숫자(자릿수 노출)", RE_COMMA),
    ("숫자+금액단위(원/만/억)", RE_KRW_UNIT),
    ("화폐기호(₩/$)", RE_SYMBOL),
]


def find_violations(path):
    """path 안의 str 리터럴을 순회하며 금액 위반 목록을 반환한다."""
    with open(path, "r", encoding="utf-8") as fh:
        src = fh.read()
    tree = ast.parse(src, filename=path)

    hits = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Constant):
            continue
        if not isinstance(node.value, str):
            continue
        lit = node.value
        if lit in ALLOWLIST:
            continue
        for reason, rx in PATTERNS:
            m = rx.search(lit)
            if m:
                hits.append((node.lineno, lit, reason, m.group(0)))
                break  # 리터럴당 한 번만 보고
    hits.sort(key=lambda h: h[0])
    return hits


def main(argv):
    targets = argv[1:] if len(argv) > 1 else TARGETS
    total = 0
    for path in targets:
        if not os.path.exists(path):
            print(f"[skip] 대상 없음: {path}")
            continue
        for lineno, lit, reason, matched in find_violations(path):
            total += 1
            shown = lit if len(lit) <= 60 else lit[:57] + "..."
            print(f'{path}:{lineno}: [{reason}] "{shown}"  <- matched: "{matched}"')

    print("-" * 60)
    if total:
        print(f"[FAIL] 금액 리터럴 {total}건 발견 — §6.10 위반. 이미지에서 금액을 제거하라.")
        return 1
    print("[OK] 금액 리터럴 없음 — §6.10 통과.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
