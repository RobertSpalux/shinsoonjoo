#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""주제 중복 검사 — python scripts/test_topic_guard.py (네트워크 없음)

2026-09-30 실제 사고 두 건을 그대로 고정한다: 「부담보 해제」(5호 발행분) · 「단체실손 중지·재개」(9/22 발행분).
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import pams_kit as kit  # noqa: E402
import topic_guard as g  # noqa: E402

ARTS = [
    {"id": "1", "slug": "insurance-remodeling-self-checklist-7", "title": "보험 리모델링 체크리스트 7 — 스스로 점검하는 법", "is_main_published": True},
    {"id": "2", "slug": "pre-existing-condition-disclosure-exclusion-guide", "title": "수술·진단 이력 있는데 보험 가입되나요 — 거절보다 흔한 건 '조건부 가입'입니다", "is_main_published": True},
    {"id": "3", "slug": "daily-life-liability-deductible-nusu", "title": "일상생활배상책임보험 자기부담금, 누수 사고는 기준이 다릅니다", "is_main_published": True},
    {"id": "4", "slug": "health-checkup-retest-disclosure-scope", "title": "건강검진 재검사, 보험 가입할 때 알려야 하는 것과 아닌 것", "is_main_published": True},
    {"id": "5", "slug": "group-personal-silson-suspend-resume", "title": "회사 단체실손 들었는데 개인 실손도 계속 내야 하나 — 중지와 1개월 재개", "is_main_published": True},
    {"id": "6", "slug": "silson-conversion-withdrawal-6month", "title": "실손보험 갈아탔는데 후회된다 — 되돌릴 수 있는 기간은 6개월, 병원에 다녀왔다면 3개월", "is_main_published": True},
    {"id": "7", "slug": "exclusion-release-5year-treatment-record", "title": "부담보 5년 지났는데 왜 안 풀렸을까 — 기준은 청구가 아니라 진료 기록입니다", "is_main_published": True},
    {"id": "8", "slug": "caregiver-daily-benefit-support-vs-use", "title": "간병인 지원일당과 사용일당, 내 간병비보험 증권엔 어느 쪽이 들어 있나요", "is_main_published": True},
    {"id": "9", "slug": "ltc-grade-home-care-rider-check", "title": "장기요양 등급 받았는데, 내 보험 재가급여 특약은 언제 나오나요", "is_main_published": False},
    {"id": "10", "slug": "manual-therapy-silson-by-rider-managed-benefit", "title": "도수치료 실비, 앞으로도 계속 나올까 — 내 실손의 구조와 특약에 따라 갈립니다", "is_main_published": False},
    {"id": "11", "slug": "old-silson-keep-or-switch-selective-discount", "title": "1세대 실비 유지해야 하나 — 기준은 보험료가 아니라 앞으로의 치료 계획입니다", "is_main_published": False},
]
BANK_MD = """
| `group-personal-silson-suspend-resume` | 회사 단체실손 … 중지와 1개월 재개 | ✅ | 본진 7180 · 네이버 6802 | A3·A4 |
| A4 | 퇴직 후 1개월 내 재개 | 퇴사하면 회사 실손 어떻게 되나 | 금감원 26.5.19 | ✅ A3 에 합침 |
| G3 | 고지의무 3개월·1년·5년 — 뭘 언제까지 말해야 하나 | 고지의무 혼란 | ✅ **2호에 통합** |
| H1 | 백내장 수술 실손, 단초점 vs 다초점렌즈 얼마 받나 | 5년 수술 1위 | ⬜ **미작성** |
상태 표기: ⬜ 미작성 / 🟡 초안 / ✅ 발행
"""


def hits(title, slug=None, naver=None):
    return g.check({"title": title, "slug": slug, "naver_title": naver}, ARTS, g.bank_done_rows(BANK_MD))


class RealIncidents(unittest.TestCase):
    def test_group_silson_blocked(self):
        h = hits("회사 실손 있는데 개인 실손도 내야 하나")
        self.assertTrue(any("group-personal-silson-suspend-resume" in x and "발행됨" in x for x in h), h)

    def test_exclusion_release_blocked(self):
        h = hits("부담보 해제, 언제 풀리나")
        self.assertTrue(any("exclusion-release-5year-treatment-record" in x for x in h), h)

    def test_merged_seed_blocked_by_bank(self):
        self.assertTrue(any("TOPIC-BANK" in x for x in hits("고지의무 3개월·1년·5년 — 뭘 언제까지 말해야 하나")))
        self.assertTrue(hits("퇴사하면 회사 실손 어떻게 되나"))


class NewTopicsPass(unittest.TestCase):
    def test_candidates_pass(self):
        for t in ("백내장 수술 실손, 단초점 vs 다초점렌즈 얼마 받나", "무릎 연골·디스크 수술 실비 얼마",
                  "상해보험 vs 실손, 중복보장 되는 것/안 되는 것", "화재·재난배상책임 의무 가입 — 우리 업종은 의무 대상인가"):
            self.assertEqual(hits(t), [], t)

    def test_existing_articles_do_not_collide_with_each_other(self):
        for a in ARTS:
            self.assertEqual(g.check(a, ARTS, []), [], a["slug"])

    def test_unwritten_bank_rows_ignored(self):
        self.assertFalse(any("백내장" in r["text"] for r in g.bank_done_rows(BANK_MD)))   # ⬜ 줄은 대상 아님
        self.assertFalse(any("상태 표기" in r["text"] for r in g.bank_done_rows(BANK_MD)))  # 표가 아닌 줄


class PredicatesAreNotTopics(unittest.TestCase):
    """2026-09-30 오탐 — 12호(본인부담상한제 환급금) 제목의 「받았는데」가 7호(장기요양 등급 받았는데…)와 주제어 겹침으로 막혔다."""

    def test_issue12_title_no_longer_collides_with_ltc(self):
        self.assertEqual(hits("본인부담상한제 환급금 받았는데, 실손 보험금은 왜 줄었나요", "copay-ceiling-refund-silson-excluded"), [])

    def test_predicates_are_recognised(self):
        for w in ("받았는데", "지났는데", "들었는데", "줄었나요", "줄었나", "풀렸을까", "풀리나", "갈립니다", "다릅니다", "다녀왔다면", "후회된다", "되는지", "받나", "이유"):
            self.assertTrue(g.is_predicate(w), w)

    def test_predicates_stay_in_terms_but_never_count_as_shared(self):
        self.assertIn("받았는데", g.terms("환급금 받았는데"))      # 핵심어 수에는 그대로 센다(비율이 안 바뀌게)
        dup, why = g.compare({"title": "본인부담상한제 환급금 받았는데 보험금이 줄었나요"}, {"title": "장기요양 등급 받았는데 재가급여가 줄었나요"})
        self.assertFalse(dup, why)

    def test_split_articles_still_do_not_collide(self):
        # 8호↔9호 — 서술어를 핵심어에서 아예 빼면 비율이 올라가 서로 걸렸다(실측). 네이버 제목까지 넣어 고정한다.
        a = {"slug": "manual-therapy-silson-by-rider-managed-benefit", "title": ARTS[9]["title"],
             "naver_title": "도수치료 실비 청구되나요 — 5세대 실손·관리급여·선택형 할인 특약에 따라 달라집니다"}
        b = {"slug": "old-silson-keep-or-switch-selective-discount", "title": ARTS[10]["title"],
             "naver_title": "오래된 실비 유지해야 하나요 — 선택형 할인 특약과 계약전환 할인, 누가 어느 쪽인가"}
        self.assertFalse(g.compare(a, b)[0], g.compare(a, b)[1])
        self.assertFalse(g.compare(b, a)[0])

    def test_shared_predicate_alone_is_not_a_duplicate(self):
        self.assertEqual(hits("치아 임플란트 받았는데 치아보험은 언제 나오나요"), [])      # 7호와 서술어만 같다
        self.assertEqual(hits("골절 치료 끝난 지 오래 지났는데 왜 안 나오나요"), [])      # 5호와 서술어만 같다

    def test_nouns_survive_the_rule(self):
        # 어미와 끝 글자가 같은 명사를 떨구지 않는다
        for w in ("본인부담상한제", "환급금", "도수치료", "장기요양", "부담보", "재가급여", "백내장", "체외충격파", "티눈", "고지의무", "면책기간", "자기부담금"):
            self.assertFalse(g.is_predicate(w), w)

    def test_real_duplicates_still_blocked(self):
        self.assertTrue(any("ltc-grade-home-care-rider-check" in x for x in hits("장기요양 등급 받았는데 재가급여는 언제 나오나요")))
        self.assertTrue(any("exclusion-release-5year-treatment-record" in x for x in hits("부담보 5년 지났는데 왜 안 풀리나요")))
        self.assertTrue(any("manual-therapy" in x for x in hits("도수치료 실비 청구되나요")))


class MeasuresAreNotTopics(unittest.TestCase):
    """2026-10-01 오탐 — 16호 제목의 「3개월」이 전환 철회 글(「…병원에 다녀왔다면 3개월」)과 주제어 겹침으로 막혔다."""

    def test_issue16_title_no_longer_collides_with_conversion(self):
        self.assertEqual(hits("해외에 3개월 이상 머물렀다면 실손보험료 환급 — 해지한 계약은 어려울 수 있습니다",
                              "overseas-stay-3month-silson-premium-refund"), [])

    def test_measures_are_recognised(self):
        for w in ("3개월", "1년", "30일", "7개", "12회", "6개월", "5년", "2", "43,850원", "95%", "석달", "하루"):
            self.assertTrue(g.is_measure(w), w)

    def test_numbered_nouns_are_not_measures(self):
        for w in ("5세대", "1세대", "2호", "3대질병", "4세대실손", "10호"):
            self.assertFalse(g.is_measure(w), w)

    def test_real_duplicates_with_numbers_still_blocked(self):
        self.assertTrue(any("silson-conversion-withdrawal-6month" in x for x in hits("실손 갈아탔는데 6개월 안에 되돌릴 수 있나")))
        self.assertTrue(any("exclusion-release-5year-treatment-record" in x for x in hits("부담보 5년 지나면 풀리나요")))

    def test_measure_alone_is_not_a_duplicate(self):
        self.assertEqual(hits("치아보험 면책기간 90일 — 언제부터 보장되나"), [])


class Rules(unittest.TestCase):
    def test_self_excluded(self):
        own = [r for r in g.bank_done_rows(BANK_MD) if "group-personal-silson-suspend-resume" in r["slugs"]]
        self.assertEqual(len(own), 1)
        self.assertEqual(g.check(ARTS[4], ARTS, own), [])   # 자기 글 + 자기 slug 가 적힌 발행 줄
        # 「A3 에 합침」처럼 slug 없이 자기를 가리키는 줄은 guard_article 의 skip_bank(접수·승인 이력)로 넘긴다

    def test_allowlist(self):
        cand = {"slug": "group-silson-retire-detail", "title": "퇴사하면 회사 실손 어떻게 되나"}
        bank = g.bank_done_rows(BANK_MD)
        self.assertTrue(g.check(cand, ARTS, bank))
        allow = [{"new": "group-silson-retire-detail", "existing": "group-personal-silson-suspend-resume", "reason": "퇴직 절차만 따로"}]
        left = g.check(cand, ARTS, bank, allow)
        self.assertFalse(any("기존 글" in x for x in left))

    def test_slug_overlap(self):
        self.assertTrue(g.compare({"slug": "exclusion-release-5year", "title": "전혀 다른 제목"},
                                  {"slug": "exclusion-release-5year-treatment-record", "title": "무관"})[0])

    def test_generic_words_do_not_trigger(self):
        self.assertEqual(g.terms("실손 보험 가입 되나요"), set())
        self.assertFalse(g.compare({"title": "실손보험 청구 기준"}, {"title": "실비 보험 가입 기준"})[0])

    def test_guard_raises_gate_error_with_reason(self):
        orig = (g.fetch_articles, g.load_allow)
        g.fetch_articles = lambda env: ARTS
        g.load_allow = lambda path=None: []
        try:
            with self.assertRaises(kit.KitError) as cm:
                g.guard({}, {"title": "회사 실손 있는데 개인 실손도 내야 하나"}, skip_bank=True)
            self.assertTrue(cm.exception.gate)
            self.assertIn("주제 중복", str(cm.exception))
            self.assertIn("group-personal-silson-suspend-resume", str(cm.exception))
            g.guard({}, {"title": "백내장 수술 실손, 단초점 vs 다초점렌즈 얼마 받나"}, skip_bank=True)   # 통과 = 예외 없음
        finally:
            g.fetch_articles, g.load_allow = orig

    def test_established_article_skips_bank(self):
        seen = {}
        orig = g.guard
        g.guard = lambda env, cand, skip_bank=False: seen.update(skip=skip_bank)
        try:
            g.guard_article({}, {"id": "1", "slug": "s", "title": "t", "ad_reviews": [{"status": "approved"}]})
            self.assertTrue(seen["skip"])
            g.guard_article({}, {"id": "1", "slug": "s", "title": "t", "ad_reviews": [{"status": "rejected"}]})
            self.assertFalse(seen["skip"])
        finally:
            g.guard = orig


class Hooks(unittest.TestCase):
    def test_build_kit_and_draft_insert_call_guard(self):
        here = os.path.dirname(os.path.abspath(__file__))
        k = open(os.path.join(here, "pams_kit.py"), encoding="utf-8").read()
        i = k.index("def build_kit(")
        self.assertIn("topic_guard.guard_article(env, article)", k[i:i + 700])
        d = open(os.path.join(here, "draft_insert.py"), encoding="utf-8").read()
        self.assertLess(d.index("topic_guard.guard("), d.index("requests.post("))   # 저장보다 검사가 먼저


if __name__ == "__main__":
    unittest.main(verbosity=1)
