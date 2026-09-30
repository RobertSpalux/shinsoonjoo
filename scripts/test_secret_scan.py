#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""커밋 전 비밀 검사 — python scripts/test_secret_scan.py (네트워크·git 없음)

가짜 값은 실행할 때 이어 붙여 만든다 — 이 파일 자체가 gitleaks·secret_scan 에 걸리지 않게.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import secret_scan as s  # noqa: E402

R = "Ab3dEf9hIj" * 12
FAKE = {
    "Anthropic 키": "sk-" + "ant-api03-" + R[:60],
    "GitHub 토큰": "gh" + "p_" + R[:36],
    "텔레그램 봇 토큰": "1234567890" + ":" + "AAH" + R[:32],
    "JWT(Supabase 키류)": "ey" + "J" + R[:20] + "." + "ey" + "J" + R[:40] + "." + R[:30],
    "AWS 액세스 키": "AK" + "IA" + "ABCDEFGHIJKLMNOP",
    "개인키 블록": "-----BEGIN " + "PRIVATE KEY-----",
    "주민등록번호 꼴": "900101" + "-" + "1234567",
}


class Text(unittest.TestCase):
    def test_each_kind_is_caught(self):
        for kind, val in FAKE.items():
            got = s.scan_text('const v = "%s";' % val)
            self.assertIn((1, kind), got, kind)

    def test_clean_code_passes(self):
        for line in ('const key = process.env.SUPABASE_SERVICE_ROLE_KEY;', 'token = state.get("tokens")', '"key": "' + "fss-precedent" + '-silson-2025",',
                     'placeholder="010-0000-0000"', "심의필 제2026-07-6977호 (2026.07.23 ~ 2027.07.22)", "보험대리점등록번호 : 2009058101",
                     "협회 등록번호 : 20030976050033", "sha256 " + "a" * 64):
            self.assertEqual(s.scan_text(line), [], line)

    def test_placeholder_is_not_a_secret(self):
        self.assertEqual(s.scan_text("ANTHROPIC_API_KEY=" + "sk-" + "ant-your_key_here_" + "x" * 30), [])

    def test_line_number_and_no_value_in_result(self):
        got = s.scan_text("a\nb\n" + FAKE["GitHub 토큰"])
        self.assertEqual(got, [(3, "GitHub 토큰")])
        self.assertNotIn(FAKE["GitHub 토큰"], repr(got))


class Names(unittest.TestCase):
    def test_blocked(self):
        for p in (".env", ".env.local", "deploy/.env.production", "x/server.pem", "_dump_sample.json", "data/soonjoo_backup_0930.json",
                  "compliance/evidence/자료.zip", "soonjoo_profile.json"):
            self.assertIsNotNone(s.blocked_name(p), p)

    def test_allowed(self):
        for p in (".env.example", "configs/sources.json", "compliance/evidence/자료.pdf", "scripts/pams_kit.py", "assets/naver/x/x-1-thumb.png",
                  "docs/ANALYZER-AUTO-BACKUP-DESIGN.md"):
            self.assertIsNone(s.blocked_name(p), p)


class Diff(unittest.TestCase):
    def test_only_added_lines_with_numbers(self):
        diff = "\n".join(["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -3,0 +4,2 @@", "+first", "+second", "@@ -9 +11 @@", "-old", "+third",
                          "diff --git a/b.ts b/b.ts", "--- a/b.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone"])
        self.assertEqual(s.parse_added(diff), {"a.ts": [(4, "first"), (5, "second"), (11, "third")]})


class Wiring(unittest.TestCase):
    def test_hook_and_ci_exist_and_gitignore_matches(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        hook = open(os.path.join(root, ".githooks", "pre-commit"), encoding="utf-8").read()
        self.assertIn("gitleaks", hook)
        self.assertIn("scripts/secret_scan.py --staged", hook)
        ci = open(os.path.join(root, ".github", "workflows", "gitleaks.yml"), encoding="utf-8").read()
        self.assertIn("fetch-depth: 0", ci)
        ig = open(os.path.join(root, ".gitignore"), encoding="utf-8").read()
        for pat in ("_dump_*", "*backup*.json", "compliance/evidence/*.zip", ".env*"):
            self.assertIn(pat, ig, pat)


if __name__ == "__main__":
    unittest.main(verbosity=1)
