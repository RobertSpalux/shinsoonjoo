#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Claude 로그인 만료 안내(OA2) — py -3.14 -X utf8 scripts/test_login_notice.py (네트워크·claude·텔레그램 호출 없음)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import draft_weekly as dw  # noqa: E402


class LoginNoticeTest(unittest.TestCase):
    def test_expired_marks(self):
        for s in ("OAuth session expired", "Token Expired", "please run /login", "HTTP 401", "Authentication failed"):
            self.assertTrue(dw.login_expired(s), s)

    def test_notice_prepended(self):
        m = dw.with_login_notice("claude -p 실패: OAuth session expired")
        self.assertTrue(m.startswith(dw.LOGIN_NOTICE))
        self.assertIn("claude /login", m)

    def test_notice_from_other_source(self):
        m = dw.with_login_notice("claude -p 실패 rc=1: ", "Failed: token expired")
        self.assertTrue(m.startswith(dw.LOGIN_NOTICE))

    def test_unchanged_without_marks(self):
        self.assertEqual(dw.with_login_notice("claude -p 실패: timeout", "timeout", None), "claude -p 실패: timeout")

    def test_daily_truncation_keeps_notice(self):
        long = "OAuth expired " + "x" * 500
        out = dw.with_login_notice(long)[:200]
        self.assertTrue(out.startswith(dw.LOGIN_NOTICE))
        self.assertEqual(len(out), 200)


if __name__ == "__main__":
    unittest.main()
