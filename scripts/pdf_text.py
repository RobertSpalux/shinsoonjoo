#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
증빙 PDF 전문 텍스트 추출 — 읽기 전용.

    py -3.14 -X utf8 scripts/pdf_text.py <PDF 경로>      # stdout 에 쪽별 텍스트

왜: 원고 문장마다 증빙 원문에 있는 것만 쓰려면 PDF 를 글자로 읽어야 한다. 셸에서 PDF 를 못 읽어
    원문 대조가 막힌 적이 있다(2026-10-08, 17호). 쪽 구분(===== p.N)을 남겨 verify_claims 의 쪽수 표기에 쓴다.
저장·수정은 하지 않는다.
"""
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def main():
    if len(sys.argv) != 2:
        print("사용법: pdf_text.py <PDF 경로>")
        sys.exit(2)
    try:
        from pypdf import PdfReader
    except ImportError:
        print("pypdf 가 필요합니다: py -3.14 -m pip install pypdf")
        sys.exit(1)
    reader = PdfReader(sys.argv[1])
    for i, page in enumerate(reader.pages, 1):
        print("===== p.%d" % i)
        print(page.extract_text() or "")


if __name__ == "__main__":
    main()
