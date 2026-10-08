#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 접수 폴더 정리 테스트 — python scripts/test_pams_folder_tidy.py

DB 는 가짜 행으로 바꿔 끼우고 「무엇을 옮기고 무엇을 남기는가」만 고정한다. 실제 Downloads 는 건드리지 않는다.
"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_folder_tidy as tidy  # noqa: E402

H = "원고해시 sha256 " + "a" * 64   # review_lock.NOTE_RX 형식(notes 에 적히는 줄)
A, B, C = "slug-approved", "slug-submitted", "slug-rejected"


def row(slug, ch, st, at="2026-10-01T09:00:00Z", notes=None, main_pub=False, naver_pub=False):
    return {"channel": ch, "status": st, "submitted_at": at, "created_at": at, "notes": notes,
            "premium_articles": {"slug": slug, "is_main_published": main_pub, "is_naver_published": naver_pub}}


def put(d, name, body="x"):
    p = os.path.join(d, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as fp:
        fp.write(body)
    return p


def kit_txt(issue, ch, slug):
    return f"[PAMS 접수 문자열] {issue} · {ch} · {slug}\n\n게시명: 제목\n"


class ParseHeadTest(unittest.TestCase):
    def test_kit_head(self):
        self.assertEqual(tidy.parse_head("[PAMS 접수 문자열] 7호 · 본진 · ltc-grade"),
                         ("PAMS 접수 문자열", "ltc-grade", "main"))
        self.assertEqual(tidy.parse_head("[PAMS 접수 문자열] 7호 · 스레드 · ltc-grade")[2], "threads")

    def test_guide_heads_are_naver(self):
        self.assertEqual(tidy.parse_head("[네이버 심의용 비공개 게시] 7호 · ltc-grade"),
                         ("네이버 심의용 비공개 게시", "ltc-grade", "naver"))
        self.assertEqual(tidy.parse_head("[네이버 승인 — 공개 전환] 7호 · ltc-grade")[1], "ltc-grade")

    def test_bom_and_garbage(self):
        self.assertEqual(tidy.parse_head("﻿[PAMS 접수 문자열] 7호 · 네이버 · s")[2], "naver")
        self.assertIsNone(tidy.parse_head("본문 첫 줄"))
        self.assertIsNone(tidy.parse_head("[PAMS 접수 문자열] 7호 · 인스타 · s"))


class DecideTest(unittest.TestCase):
    def test_latest_row_wins(self):
        rows = [row(A, "main", "rejected", "2026-09-30T00:00:00Z"), row(A, "main", "approved", "2026-10-02T00:00:00Z", H)]
        self.assertTrue(tidy.decide("PAMS 접수 문자열", A, "main", rows)[0])
        rows = [row(A, "main", "approved", "2026-09-30T00:00:00Z", H), row(A, "main", "rejected", "2026-10-02T00:00:00Z")]
        self.assertFalse(tidy.decide("PAMS 접수 문자열", A, "main", rows)[0])

    def test_stays(self):
        for st in ("submitted", "under_review", "rejected"):
            self.assertFalse(tidy.decide("PAMS 접수 문자열", A, "main", [row(A, "main", st, notes=H)])[0], st)
        self.assertEqual(tidy.decide("PAMS 접수 문자열", A, "main", []), (False, "미접수(심의 행 없음)"))

    def test_approved_needs_hash_or_published(self):
        """review_lock 이 맨 위 키트 txt 에서 해시를 읽기 전에는 옮기지 않는다."""
        self.assertFalse(tidy.decide("PAMS 접수 문자열", A, "main", [row(A, "main", "approved")])[0])
        self.assertTrue(tidy.decide("PAMS 접수 문자열", A, "main", [row(A, "main", "approved", main_pub=True)])[0])
        noted = f"{H} (0929_7호_본진.zip · 09-29 10:00)"
        self.assertTrue(tidy.decide("PAMS 접수 문자열", A, "naver", [row(A, "naver", "approved", notes=noted)])[0])

    def test_threads_any_active_row_stays(self):
        rows = [row(A, "threads", "approved", "2026-10-02T00:00:00Z"), row(A, "threads", "submitted", "2026-09-01T00:00:00Z")]
        self.assertFalse(tidy.decide("PAMS 접수 문자열", A, "threads", rows)[0])
        self.assertTrue(tidy.decide("PAMS 접수 문자열", A, "threads", rows[:1])[0])

    def test_publish_guide_waits_for_naver_published(self):
        k = "네이버 승인 — 공개 전환"
        self.assertFalse(tidy.decide(k, A, "naver", [row(A, "naver", "approved", notes=H)])[0])
        self.assertTrue(tidy.decide(k, A, "naver", [row(A, "naver", "approved", naver_pub=True)])[0])

    def test_other_article_rows_ignored(self):
        self.assertFalse(tidy.decide("PAMS 접수 문자열", A, "main", [row(B, "main", "approved", notes=H)])[0])


class FolderTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        noted = H
        self.rows = [row(A, "main", "approved", notes=noted), row(A, "naver", "approved", notes=noted),
                     row(B, "main", "submitted"), row(C, "naver", "rejected")]
        # 승인 — 본진 키트 묶음
        put(self.d, "0929_7호_본진.txt", kit_txt("7호", "본진", A))
        put(self.d, "0929_7호_본진.zip")
        # 🔴 파일명 호수는 「9호」지만 머리줄 slug 는 심사중 글 — 머리줄이 이긴다
        put(self.d, "1001_9호_본진.txt", kit_txt("7호", "본진", B))
        put(self.d, "1001_9호_본진.zip")
        put(self.d, "1002_8호_네이버.txt", kit_txt("8호", "네이버", C))
        put(self.d, "1002_8호_네이버.zip")
        put(self.d, "메모.txt", "손으로 둔 메모")
        put(self.d, "17호.pdf")   # 맨 위 캡처 — pams_auto 가 짝지을 것. 건드리지 않는다
        # 비공개 안내(승인 → 옮김)
        g = "_네이버비공개"
        put(self.d, f"{g}/0930_7호_네이버비공개.txt", f"[네이버 심의용 비공개 게시] 7호 · {A}\n")
        put(self.d, f"{g}/0930_7호_네이버비공개_본문.txt", "본문")
        put(self.d, f"{g}/0930_7호_네이버비공개_이미지1.png")
        put(self.d, f"{g}/0930_7호_네이버비공개.html")
        # 공개 전환 안내 — 승인됐지만 아직 공개 전 → 그대로
        put(self.d, "_네이버게시/1003_7호_네이버.txt", f"[네이버 승인 — 공개 전환] 7호 · {A}\n")
        put(self.d, "_네이버게시/1003_7호_네이버_본문.txt", "본문")
        put(self.d, "캡처_처리됨/백내장.pdf")
        put(self.d, "캡처_처리됨/모름.pdf")
        self.captures = {"백내장.pdf": {"status": "done", "slug": A}}

    def rel(self, *p):
        return os.path.join(self.d, *p)

    def test_dry_run_moves_nothing(self):
        lines = tidy.run({}, do_apply=False, kit_dir=self.d, rows=self.rows, captures=self.captures, log=lambda s: None)
        self.assertTrue(os.path.exists(self.rel("0929_7호_본진.zip")))
        self.assertFalse(os.path.exists(self.rel(tidy.DONE_ROOT)))
        self.assertIn("드라이런", lines[0])
        self.assertTrue(any("0929_7호_본진.zip" in ln and "⇒" in ln for ln in lines))

    def test_apply(self):
        tidy.run({}, do_apply=True, kit_dir=self.d, rows=self.rows, captures=self.captures, log=lambda s: None)
        done = lambda *p: os.path.exists(self.rel(tidy.DONE_ROOT, *p))  # noqa: E731
        self.assertTrue(done("본진", "0929_7호_본진.zip") and done("본진", "0929_7호_본진.txt"))
        for n in ("0930_7호_네이버비공개.txt", "0930_7호_네이버비공개_본문.txt",
                  "0930_7호_네이버비공개_이미지1.png", "0930_7호_네이버비공개.html"):
            self.assertTrue(done("네이버비공개", n), n)
        self.assertTrue(done("캡처", "백내장.pdf"))
        # 남는 것
        for p in ("1001_9호_본진.zip", "1002_8호_네이버.zip", "메모.txt", "17호.pdf",
                  os.path.join("_네이버게시", "1003_7호_네이버.txt"), os.path.join("캡처_처리됨", "모름.pdf")):
            self.assertTrue(os.path.exists(self.rel(p)), p)
        # 삭제 없음 — 파일 수가 그대로다
        total = sum(len(f) for _, _, f in os.walk(self.d))
        self.assertEqual(total, 16)

    def test_existing_target_not_overwritten(self):
        put(self.d, os.path.join(tidy.DONE_ROOT, "본진", "0929_7호_본진.zip"), "이미 있음")
        tidy.run({}, do_apply=True, kit_dir=self.d, rows=self.rows, captures=self.captures, log=lambda s: None)
        self.assertTrue(os.path.exists(self.rel("0929_7호_본진.zip")))
        with open(self.rel(tidy.DONE_ROOT, "본진", "0929_7호_본진.zip"), encoding="utf-8") as fp:
            self.assertEqual(fp.read(), "이미 있음")

    def test_second_apply_is_quiet(self):
        log = []
        tidy.run({}, do_apply=True, kit_dir=self.d, rows=self.rows, captures=self.captures, log=log.append)
        self.assertTrue(log)
        log.clear()
        self.assertEqual(tidy.run({}, do_apply=True, kit_dir=self.d, rows=self.rows, captures=self.captures,
                                  log=log.append), [])
        self.assertEqual(log, [])

    def test_threads_sidecar_moves_with_kit(self):
        put(self.d, "1005_7호_스레드.txt", kit_txt("7호", "스레드", A))
        put(self.d, "1005_7호_스레드.zip")
        put(self.d, "1005_7호_스레드.kit/kit.json", "{}")
        rows = self.rows + [row(A, "threads", "approved")]
        tidy.run({}, do_apply=True, kit_dir=self.d, rows=rows, captures=self.captures, log=lambda s: None)
        self.assertTrue(os.path.exists(self.rel(tidy.DONE_ROOT, "스레드", "1005_7호_스레드.kit", "kit.json")))

    def test_missing_dir(self):
        self.assertEqual(tidy.run({}, kit_dir=os.path.join(self.d, "없음"), rows=[], captures={}), [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
