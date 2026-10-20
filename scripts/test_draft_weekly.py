#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""주 3편 초안 공급기 — python scripts/test_draft_weekly.py (네트워크·DB·claude 호출 없음)

금소법 게이트(rules_finance_gate 2단·17항)가 걸러야 할 문장은 걸러야 하고, 정본 유의문구·「수익자」 같은
정상 낱말은 통과해야 한다. 순환은 연금→종신→법인→절세 순서로 3개씩, 쓴 주제(통과·반려 폴더)는 건너뛴다.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import draft_weekly as dw  # noqa: E402
import naver_rules as nr  # noqa: E402

CFG = dw.load_topics()
TOPIC = {t["slug"]: t for t in CFG["topics"]}
WL = TOPIC["whole-life-death-benefit-sum-by-cause"]
WL_NOTICES = dw.notice_texts(CFG, WL)
LINKS = CFG["internal_links"]


def naver_body(extra="", notices=WL_NOTICES):
    lines = ["상담을 하다 보면 사망보장이 여러 계약에 흩어져 있는 분이 많습니다."]
    lines.append("사망보장은 원인별로 나누어 합산해야 실제 합계가 보입니다. " * 60)
    if extra:
        lines.append(extra)
    lines += ["자주 묻는 질문 3가지"] + sum(([f"Q. 질문 {i}인가요", "A. 답입니다."] for i in range(1, 4)), [])
    lines += ["핵심 요약", "1. 하나", "2. 둘", "3. 셋"] + list(notices) + ["관련 글"] + LINKS
    return "\n".join(lines)


def draft(extra="", title="종신보험 사망보험금 원인별로 나눠 합산해야 보이는 공백", notices=WL_NOTICES):
    return {"title": "종신보험 사망보험금, 원인별 합산", "naver_title": title, "summary": "요약입니다.",
            "tags": ["종신보험"], "key_points": ["하나"], "faq_json": [{"question": "q", "answer": "a"}], "verify_claims": [],
            "naver": naver_body(extra, notices), "main": "## 원인별 합산\n" + "\n".join(notices)}


def reasons(issues):
    return " | ".join(i["reason"] for i in issues)


DEMAND = [t for t in CFG["topics"] if t.get("basis")]
LEGACY = [t for t in CFG["topics"] if not t.get("basis")]


class LedgerTest(unittest.TestCase):
    def test_demand_topics_first(self):
        """SUP1 — 수요 근거(basis) 주제가 맨 위, 그 아래에 SH13 순환. 섞이지 않는다."""
        n = len(DEMAND)
        self.assertGreaterEqual(n, 15)
        self.assertTrue(all(t.get("basis") for t in CFG["topics"][:n]))
        self.assertFalse(any(t.get("basis") for t in CFG["topics"][n:]))

    def test_demand_topics_have_fields(self):
        for t in DEMAND:
            with self.subTest(t["slug"]):
                for k in ("keyword", "angle", "notices", "basis", "existing"):
                    self.assertIn(k, t)
                self.assertTrue(t["keyword"] and t["angle"])
                self.assertRegex(t["basis"], r"TR3|IX1")

    def test_rotation_order(self):
        cats = [t["category"] for t in LEGACY]
        self.assertEqual(cats[:4], ["연금", "종신", "법인", "절세"])
        self.assertEqual(cats, (["연금", "종신", "법인", "절세"] * 3)[:len(cats)])

    def test_slugs_unique_and_titles_fit_keyword_rule(self):
        slugs = [t["slug"] for t in CFG["topics"]]
        self.assertEqual(len(slugs), len(set(slugs)))
        for t in CFG["topics"]:
            self.assertIn(t["category"], dw.DB_CATEGORY)
            for k in t["notices"]:
                self.assertIn(k, CFG["notices"])

    def test_notices_match_rules_original(self):
        """유의문구는 rules_finance_gate.md 원문과 글자 단위로 같아야 한다(손으로 옮겨 적은 오탈자 = 반송)."""
        if not os.path.exists(dw.RULES_MD):
            self.skipTest("rules_finance_gate.md 없음(robert-os 밖)")
        rules = open(dw.RULES_MD, encoding="utf-8").read()
        for key, lines in CFG["notices"].items():
            for s in lines:
                self.assertIn(s, rules, f"{key}: {s}")

    def test_pick_skips_used_and_takes_three(self):
        slugs = [t["slug"] for t in CFG["topics"]]
        picked = dw.pick_topics(CFG, set(), 3)
        self.assertEqual([t["slug"] for t in picked], slugs[:3])
        picked = dw.pick_topics(CFG, {p["slug"] for p in picked} | {slugs[4]}, 3)
        self.assertEqual([t["slug"] for t in picked], [slugs[3], slugs[5], slugs[6]])
        rest = dw.pick_topics(CFG, {t["slug"] for t in DEMAND}, 3)
        self.assertEqual([t["category"] for t in rest], ["연금", "종신", "법인"])

    def test_used_slugs_from_pass_and_reject_dirs(self):
        d = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(d, "20261012_annuity-start-age-payout-type-check"))
            os.makedirs(os.path.join(d, "_rejected", "20261012_whole-life-death-benefit-sum-by-cause"))
            os.makedirs(os.path.join(d, "_work"))
            self.assertEqual(dw.used_slugs(d), {"annuity-start-age-payout-type-check", "whole-life-death-benefit-sum-by-cause"})
        finally:
            shutil.rmtree(d)


class FinanceGateTest(unittest.TestCase):
    def gate(self, extra="", **kw):
        return dw.finance_gate(draft(extra, **kw), WL, WL_NOTICES, ["상기 내용은 보험설계사의 의견이며, 계약체결에 따른 이익 또는 손실은 보험계약자 등에게 귀속됩니다."])

    def test_clean_draft_passes(self):
        self.assertEqual(self.gate(), [])

    def test_beneficiary_word_is_not_savings(self):
        self.assertEqual(self.gate("수익자를 누구로 지정했는지 함께 봅니다. 여러 절차를 거치는 동안 서류가 바뀝니다."), [])

    def test_blocks(self):
        cases = {
            "무료": "무료로 점검해 드립니다.",
            "수익률 단정": "원금 보장이 되는 구조입니다.",
            "비교·추천": "이 구조를 추천합니다.",
            "타 업권 비교": "은행보다 낫다고 보기는 어렵습니다.",
            "상담 유인": "카톡으로 상담 신청을 남겨 주십시오.",
            "보장성 저축성 표현": "종신보험으로 목돈을 만드는 방법입니다.",
            "금액 노출": "사망보험금이 1억원인 경우입니다.",
            "수익률·이율": "환급률이 120% 수준입니다.",
            "일화 날조": "지난달 만난 고객께서 말씀하셨습니다.",
            "보험사명": "삼성생명 계약을 예로 듭니다.",
        }
        for name, sentence in cases.items():
            with self.subTest(name):
                self.assertIn(name, reasons(self.gate(sentence)))

    def test_placeholder_number_passes(self):
        self.assertEqual(self.gate("공제 한도는 [확인: 연 100만원] 입니다."), [])

    def test_missing_notice_blocks(self):
        self.assertIn("유의문구 원문 빠짐", reasons(dw.finance_gate(draft(notices=WL_NOTICES[:1]), WL, WL_NOTICES)))

    def test_tax_needs_advice_notice(self):
        self.assertIn("세무사", reasons(self.gate("상속세 문제는 따로 봅니다.")))

    def test_title_tax_free_needs_suffix(self):
        sv = TOPIC["savings-insurance-tax-free-requirements"]
        n = dw.notice_texts(CFG, sv)
        d = draft(title="저축성보험 비과세 요건 계약별로 점검하는 순서", notices=n)
        self.assertIn("관련 세법 요건 충족시", reasons(dw.finance_gate(d, sv, n)))
        d = draft(title="저축성보험 비과세 요건 관련 세법 요건 충족시 점검", notices=n)
        self.assertNotIn("관련 세법 요건 충족시", reasons(dw.finance_gate(d, sv, n)))

    def test_initials_alphabetical(self):
        self.assertIn("알파벳", reasons(self.gate("B사 계약과 A사 계약을 나란히 봅니다.")))
        self.assertEqual(self.gate("A사 계약과 B사 계약을 나란히 봅니다."), [])


class OverlapTest(unittest.TestCase):
    PUBLISHED = "부담보 기간이 끝났는데도 해제 신청을 하지 않아 그대로 남아 있는 경우가 있습니다. 증권을 다시 보아야 합니다."

    def test_copied_sentence_blocks(self):
        c = dw.build_corpus([("DB x naver", self.PUBLISHED)])
        hits = dw.overlap("새 문장입니다. 부담보 기간이 끝났는데도 해제 신청을 하지 않아 그대로 남아 있는 경우가 있습니다.", c)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["source"], "DB x naver")

    def test_lightly_edited_copy_blocks(self):
        c = dw.build_corpus([("DB x naver", self.PUBLISHED)])
        hits = dw.overlap("부담보 기간이 끝났는데도 해제 신청을 하지 않아서 그대로 남아 있는 경우가 많습니다.", c)
        self.assertTrue(hits)

    def test_notice_and_new_text_pass(self):
        n = "중도해지 시 납입한 보험료보다 환급금이 적거나 없을 수 있습니다."
        c = dw.build_corpus([("DB x naver", self.PUBLISHED + "\n" + n)])
        self.assertEqual(dw.overlap("종신보험 특약은 만기가 따로 정해진 경우가 많습니다.\n" + n, c, exempt=[n]), [])

    # SH18(2026-10-14): 같은 블로그 URL 숫자 조각·같은 자료명 출처 줄이 「베낀 문장」으로 잡혔다
    OTHER = ("앞선 글입니다.\nhttps://blog.naver.com/insightlab-daily/224439282318\n\n출처\n"
             "1. 금융감독원, 주요 민원사례로 알아보는 소비자 유의사항 - 보험계약대출 관련 유의사항 -, 2025, 2025.3.31 — 3쪽")

    def test_canonical_lines_url_and_sources(self):
        got = dw.canonical_lines("본문입니다.\nhttps://blog.naver.com/insightlab-daily/224433950154\n\n출처\n1. 가, 나, 2026, 2026.1.1\n")
        self.assertIn("https://blog.naver.com/insightlab-daily/224433950154", got)
        self.assertIn("1. 가, 나, 2026, 2026.1.1", got)
        self.assertNotIn("본문입니다.", got)

    def test_internal_url_and_source_line_not_overlap(self):
        c = dw.build_corpus([("DB y naver", self.OTHER)])
        new = ("새 글 본문입니다.\nhttps://blog.naver.com/insightlab-daily/224433950154\n\n출처\n"
               "1. 금융감독원, 주요 민원사례로 알아보는 소비자 유의사항 - 보험계약대출 관련 유의사항 -, 2025, 2025.3.31 — 1쪽")
        self.assertTrue(dw.overlap(new, c))                                   # 예외 없이 재면 잡힌다(종전 동작)
        self.assertEqual(dw.overlap(new, c, exempt=dw.canonical_lines(new)), [])

    def test_body_copy_still_blocks_with_canonical_exempt(self):
        c = dw.build_corpus([("DB x naver", self.PUBLISHED)])
        new = "부담보 기간이 끝났는데도 해제 신청을 하지 않아 그대로 남아 있는 경우가 있습니다.\n\n출처\n1. 가, 나, 2026, 2026.1.1"
        self.assertTrue(dw.overlap(new, c, exempt=dw.canonical_lines(new)))  # 본문 문장은 그대로 잰다


class TsVerdictTest(unittest.TestCase):
    """check_draft.mts 결과 해석 — 근거 위반이 [확인: ___] 칸 때문뿐이면 초안은 남기고, 나머지는 막는다."""
    OK = {"pass": False, "banned": {"level": "pass"}, "style": {"pass": True}}

    def ev(self, *bases):
        return {**self.OK, "evidence": {"issues": [{"level": "violation", "code": "no_year", "basis": b} for b in bases]}}

    def test_placeholder_only_evidence_passes(self):
        self.assertTrue(dw.ts_verdict(self.ev("국가법령정보센터, 상법 제733조, [확인: 최종 개정일]")))

    def test_real_evidence_gap_blocks(self):
        self.assertFalse(dw.ts_verdict(self.ev("[확인: 개정일] 상법", "업계 통용")))

    def test_banned_or_style_blocks(self):
        self.assertFalse(dw.ts_verdict({**self.ev("[확인: 연도]"), "banned": {"level": "block"}}))
        self.assertFalse(dw.ts_verdict({**self.ev("[확인: 연도]"), "style": {"pass": False}}))


class ImageConfigTest(unittest.TestCase):
    """SUP1 — 생성 결과 naver_images → 사진 설정. slug·cta_url 은 코드가 채우고, 금액·금소법 표현은 막는다."""
    RAW = {"overline": "종신보험 사망보험금", "title": "사망보험금은\n숫자 하나가\n아닙니다", "subtitle": "원인별 합계",
           "table_title": "원인별 보장", "col_before": "질병", "col_after": "사고",
           "table_rows": [["일반사망", "더해짐", "더해짐"]], "table_note": "계약별 증권과 약관 기준",
           "contrast_title": "두 기간", "contrast": [["납입기간", "보험료를 내는 기간"], ["보험기간", "보장 기간"]],
           "contrast_note": "계약별 약관 기준", "flow_title": "보는 순서", "flow": [["보장 구분", "나누기"]],
           "flow_note": "계약별 약관 기준", "points_title": "세 가지", "points": ["하나", "둘", "셋"],
           "cta_line": "내 사망보장", "cta_sub": "전 계약 점검", "slug": "모델이-쓴-값", "cta_url": "example.com"}

    def test_code_fills_slug_and_url(self):
        c = dw.image_config(self.RAW, "whole-life-x")
        self.assertEqual(c["slug"], "whole-life-x")
        self.assertEqual(c["cta_url"], dw.CTA_URL)
        self.assertEqual(dw.image_issues(c), [])

    def test_blocks_money_banned_and_missing(self):
        c = dw.image_config({**self.RAW, "subtitle": "사망보험금 1억원 기준"}, "x")
        self.assertIn("금액", " ".join(dw.image_issues(c)))
        c = dw.image_config({**self.RAW, "cta_sub": "카톡으로 상담 신청"}, "x")
        self.assertIn("상담 유인", " ".join(dw.image_issues(c)))
        c = dw.image_config({k: v for k, v in self.RAW.items() if k != "flow"}, "x")
        self.assertIn("빠진 칸", " ".join(dw.image_issues(c)))

    def test_prompt_asks_for_image_keys(self):
        p = dw.build_prompt(WL, CFG, "")
        self.assertIn('"naver_images"', p)
        for k in dw.IMAGE_KEYS:
            self.assertIn(f'"{k}"', p)


class JudgeTest(unittest.TestCase):
    def test_placeholders_include_verify_claims(self):
        d = draft()
        d["verify_claims"] = [{"claim": "c", "basis": "상법 제733조, [확인: 최종 개정일]"}]
        r = dw.judge(d, WL, CFG, dw.build_corpus([]), env=None, use_ts=False)
        self.assertIn("[확인: 최종 개정일]", r["placeholders"])
        self.assertEqual(len(r["unrun"]), 2)

    def test_judge_runs_all_stages_without_db_or_ts(self):
        d = draft()
        d["naver_title"] = "종신보험 사망보험금 원인별로 나눠 합산해야 보이는 공백"
        r = dw.judge(d, WL, CFG, dw.build_corpus([]), env=None, use_ts=False)
        names = [s["name"] for s in r["stages"]]
        self.assertEqual(len(names), 6)
        self.assertTrue(r["stages"][0]["pass"], r["stages"][0])
        self.assertTrue(all(s["pass"] for s in r["stages"] if "네이버" not in s["name"]))
        self.assertEqual(nr.check_title(d["naver_title"], WL["keyword"])[0], [])

    def test_rejected_entry_lists_stage_reason_sentence(self):
        d = draft("무료로 점검해 드립니다.")
        r = dw.judge(d, WL, CFG, dw.build_corpus([]), env=None, use_ts=False)
        self.assertFalse(r["pass"])
        txt = dw.rejected_entry("2026-10-12T09:00:00", WL, d, r)
        self.assertIn("금소법 게이트(rules_finance_gate): 반려", txt)
        self.assertIn("무료로 점검해 드립니다.", txt)

    def test_save_routes_pass_and_reject(self):
        out = tempfile.mkdtemp()
        try:
            d = draft()
            ok = {"pass": True, "stages": [], "placeholders": []}
            p = dw.save(out, WL, d, ok, "20261012", "t")
            self.assertTrue(os.path.exists(os.path.join(p, "naver.txt")))
            meta = json.load(open(os.path.join(p, "meta.json"), encoding="utf-8"))
            self.assertEqual(meta["naver_keyword"], WL["keyword"])
            bad = {"pass": False, "stages": [{"name": "x", "pass": False, "issues": ["사유"]}], "placeholders": []}
            q = dw.save(out, TOPIC["annuity-start-age-payout-type-check"], d, bad, "20261012", "t")
            self.assertIn("_rejected", q)
            self.assertIn("사유", open(os.path.join(out, "_rejected.md"), encoding="utf-8").read())
        finally:
            shutil.rmtree(out)


if __name__ == "__main__":
    unittest.main()
