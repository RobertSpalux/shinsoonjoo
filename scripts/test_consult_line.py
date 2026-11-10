#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""상담 안내 한 줄(LK1) — python scripts/test_consult_line.py (네트워크·DB 없음)

정본 줄(코드가 붙인 꼬리)만 「상담 유인」 검사를 지나가고, 모델이 직접 쓴 상담 유인 문장은 그대로 막혀야 한다.
"""
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import consult_line as cl  # noqa: E402
import draft_weekly as dw  # noqa: E402
import test_draft_weekly as tdw  # noqa: E402

SLUG = tdw.WL["slug"]


class ConsultLineTest(unittest.TestCase):
    def test_url_matches_brand(self):
        """카카오 채팅 주소는 brand.ts BRAND.social.kakaoChat 과 같아야 한다(단일 출처 대조)."""
        brand = open(os.path.join(HERE, "..", "src", "lib", "brand.ts"), encoding="utf-8").read()
        self.assertIn(f'kakaoChat: "{cl.KAKAO_CHAT_URL}"', brand)
        route = open(os.path.join(HERE, "..", "src", "app", "go", "kakao", "route.ts"), encoding="utf-8").read()
        self.assertIn("BRAND.social.kakaoChat", route)

    def test_examples_pass_intent_check(self):
        for topic, intent in cl.INTENT_EXAMPLES:
            with self.subTest(topic):
                self.assertEqual(cl.check_intent(intent), [])

    def test_intent_rejects_banned(self):
        bad = {
            "무료로 내 실손을 함께 점검하고 싶으시면": "무료",
            "내 실손에서 청구가 가능합니다 확인하고 싶으시면": "단정",
            "숨은 보험금을 찾아 드리는 상담을 받고 싶으시면": "약속",
            "더 나은 상품을 추천받고 싶으시면 지금 상담을": "형식",
            "지금 바로 내 계약을 함께 보고 싶으시면": "다급함",
            "보험료를 줄이는 방법을 함께 보고 싶으시면": "절감",
        }
        for intent, why in bad.items():
            with self.subTest(intent):
                self.assertTrue(any(why in m for m in cl.check_intent(intent)), cl.check_intent(intent))

    def test_insert_after_advice_both_channels(self):
        d = tdw.draft()
        nv = d["naver"].split("\n")
        k = nv.index(cl.naver_block(tdw.INTENT, SLUG)[0])
        self.assertEqual(nv[k - 2], "원인별로 나누어 합산한 표를 먼저 보셔야 합니다.")
        self.assertEqual(nv[k + 1], f"https://goodfinance.kr/go/kakao?ref={SLUG}")
        self.assertIn(cl.main_line(tdw.INTENT), d["main"])
        self.assertLess(d["main"].index("한 줄 조언"), d["main"].index(cl.MAIN_TAIL))
        self.assertEqual(cl.issues(d["naver"], "naver", SLUG), [])
        self.assertEqual(cl.issues(d["main"], "main", SLUG), [])
        # 두 번 넣어도 한 줄
        self.assertEqual(dw.add_consult(d, SLUG)["naver"], d["naver"])

    def test_gate_passes_canonical_line_only(self):
        d = tdw.draft()
        fin = dw.finance_gate(d, tdw.WL, tdw.WL_NOTICES, [], consult_slug=SLUG)
        self.assertEqual([i for i in fin if "상담" in i["reason"]], [])
        # 모델이 본문에 직접 쓴 상담 유인은 여전히 막힌다
        d2 = tdw.draft("궁금하시면 카카오톡으로 상담 문의 주세요.")
        self.assertIn("상담 유인", tdw.reasons(dw.finance_gate(d2, tdw.WL, tdw.WL_NOTICES, [], consult_slug=SLUG)))

    def test_gate_requires_line_for_new_drafts(self):
        d = tdw.draft()
        d["naver"] = "\n".join(ln for ln in d["naver"].split("\n") if cl.TAIL not in ln and "go/kakao" not in ln)
        r = tdw.reasons(dw.finance_gate(d, tdw.WL, tdw.WL_NOTICES, [], consult_slug=SLUG))
        self.assertIn("상담 안내 줄 0개", r)
        # consult_slug 없으면(옛 원고·승인본 재검사) 요구하지 않는다
        self.assertNotIn("상담 안내", tdw.reasons(dw.finance_gate(d, tdw.WL, tdw.WL_NOTICES, [])))

    def test_gate_rejects_bad_intent_inside_line(self):
        d = tdw.draft()
        bad = "무료로 내 계약을 함께 보고 싶으시면"
        d["naver"] = d["naver"].replace(tdw.INTENT, bad)
        r = tdw.reasons(dw.finance_gate(d, tdw.WL, tdw.WL_NOTICES, [], consult_slug=SLUG))
        self.assertIn("상담 안내 의도 구절 무료", r)

    def test_wrong_url_rejected(self):
        d = tdw.draft()
        d["naver"] = d["naver"].replace(f"go/kakao?ref={SLUG}", "go/kakao?ref=other-slug")
        self.assertTrue(any("URL" in m for m in cl.issues(d["naver"], "naver", SLUG)))

    def test_canonical_lines_exempt_from_overlap(self):
        d = tdw.draft()
        canon = dw.canonical_lines(d["naver"])
        self.assertIn(cl.naver_block(tdw.INTENT, SLUG)[0], canon)
        self.assertIn(f"https://goodfinance.kr/go/kakao?ref={SLUG}", canon)

    def test_prompt_asks_for_intent(self):
        p = dw.build_prompt(tdw.WL, tdw.CFG, "")
        self.assertIn('"consult_intent"', p)
        self.assertIn(cl.CHANNEL_NAME, p)
        self.assertTrue(re.search(r"싶으시면", p))

    def test_parse_requires_intent(self):
        import json
        d = {k: "x" for k in ("title", "naver_title", "summary", "naver", "main")}
        d.update(tags=["a"], key_points=["a"], faq_json=[{"q": 1}], verify_claims=[{"c": 1}])
        with self.assertRaises(Exception):
            dw.parse_draft(json.dumps(d, ensure_ascii=False))
        d["consult_intent"] = tdw.INTENT
        self.assertEqual(dw.parse_draft(json.dumps(d, ensure_ascii=False))["consult_intent"], tdw.INTENT)


if __name__ == "__main__":
    unittest.main()
