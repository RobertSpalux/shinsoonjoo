#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hermes 래퍼 — py -3.14 -X utf8 scripts/test_draft_daily_cron.py (네트워크·DB·claude·텔레그램 호출 없음)"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import draft_daily_cron as w  # noqa: E402


class WrapperTest(unittest.TestCase):
    def test_non_main_skips_and_notifies(self):
        with mock.patch.object(w, "current_branch", return_value="feat/x"), \
             mock.patch.object(w, "notify") as n, mock.patch.object(w.subprocess, "run") as run:
            self.assertEqual(w.main([]), w.SKIP)
            n.assert_called_once()
            run.assert_not_called()

    def test_unknown_branch_skips(self):
        with mock.patch.object(w, "current_branch", return_value=None), mock.patch.object(w, "notify"):
            self.assertEqual(w.main([]), w.SKIP)

    def test_check_mode_never_notifies_or_runs(self):
        with mock.patch.object(w, "current_branch", return_value="feat/x"), \
             mock.patch.object(w, "notify") as n, mock.patch.object(w.subprocess, "run") as run:
            self.assertEqual(w.main(["--check"]), w.SKIP)
            n.assert_not_called()
            run.assert_not_called()
        with mock.patch.object(w, "current_branch", return_value="main"), mock.patch.object(w.subprocess, "run") as run:
            self.assertEqual(w.main(["--check"]), 0)
            run.assert_not_called()

    def test_main_propagates_exit_code(self):
        for code in (0, 1):
            with mock.patch.object(w, "current_branch", return_value="main"), \
                 mock.patch.object(w.subprocess, "run", return_value=mock.Mock(returncode=code)) as run:
                self.assertEqual(w.main([]), code)
                self.assertIn("draft_daily.py", run.call_args[0][0][-1])


if __name__ == "__main__":
    unittest.main()
