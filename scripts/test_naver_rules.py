#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""네이버 규칙 10 기계 검사 — python scripts/test_naver_rules.py (네트워크 없음)

TR2(2026-10-09) 실측의 우리 제목을 그대로 고정한다: 45~50자 「— 부제」형은 실패해야 하고,
승부 키워드 15 제안 제목은 전부 통과해야 한다(금지어 A·B 등급 0 포함).
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import naver_rules as nr  # noqa: E402
import preflight  # noqa: E402

LINK_A = "https://blog.naver.com/insightlab-daily/224400000001"
LINK_B = "https://goodfinance.kr/news/exclusion-release-5year-treatment-record"
LINK_C = "https://m.blog.naver.com/insightlab-daily/224400000002"
LINK_D = "https://goodfinance.kr/news/daily-life-liability-deductible-nusu"


TABLE = ["[표1] 세대별로 들어 있는 자리", "구분 | 자리 | 근거", "3·4세대 | 특약으로 분리 | 표준약관"]


BASIS = "이 글은 국가법령정보센터의 「상법 제662조(소멸시효)」(2025.9.9)를 근거로 원리를 정리합니다."


def body(n_chars=2800, faq=3, summary=True, links=(LINK_A, LINK_B), faq_head=None, table=TABLE, images=5, basis=BASIS):
    lines = ["상담을 하다 보면 같은 질문을 하시는 분이 많습니다."] + ([basis] if basis else [])
    media = list(table) + [f"[이미지{'①②③④⑤⑥⑦⑧⑨⑩'[i]}]" for i in range(images)]
    filler = "가" * (n_chars - nr.body_len("\n".join(lines + media)) - 200)
    lines.append(filler)
    lines += media
    lines.append(faq_head or f"자주 묻는 질문 {faq}가지")
    for i in range(faq):
        lines += [f"Q. 질문 {i + 1}인가요", "A. 답입니다."]
    if summary:
        lines += ["핵심 요약", "1. 요약 하나", "2. 요약 둘", "3. 요약 셋"]
    lines += ["관련 글"] + list(links)
    return "\n".join(lines)


class TitleTest(unittest.TestCase):
    def test_tr2_our_long_titles_fail(self):
        # TR2 B-5 실측 — 우리 제목은 45~50자 「— 부제」형이었다
        t = "무릎 줄기세포 주사 수술비 보험 나오나요 — 신경성형술 실손 입원·통원까지 금감원 분쟁사례"
        f, _ = nr.check_title(t, "신경성형술 실비")
        self.assertTrue(any("자 —" in x for x in f), f)
        self.assertTrue(any("빠짐" in x for x in f), f)   # 「실비」가 없다

    def test_keyword_must_be_front(self):
        f, _ = nr.check_title("내 보험 증권에서 사고별로 찾아보는 일상생활배상책임보험 자기부담금", "일상생활배상책임보험 자기부담금")
        self.assertTrue(any("맨 앞" in x for x in f), f)

    def test_question_mark_banned(self):
        f, _ = nr.check_title("부담보 해제 후 그 부위로 병원에 가면 실손에서 바로 보장되나요?", "부담보 해제")
        self.assertTrue(any("특수문자" in x for x in f), f)

    def test_short_title_fails(self):
        f, _ = nr.check_title("부담보 해제 조건 정리", "부담보 해제")
        self.assertTrue(any("30~40자" in x for x in f), f)

    def test_no_keyword_is_note_not_fail(self):
        f, n = nr.check_title("부담보 해제 후 그 부위로 병원에 가면 실손에서 바로 보장되나요")
        self.assertEqual(f, [])
        self.assertTrue(n)

    def test_plan_titles_all_pass(self):
        plan = nr.load_keywords()["plan"]
        self.assertEqual(len(plan), 15)
        self.assertEqual(len({p["keyword"] for p in plan}), 15)
        for p in plan:
            f, _ = nr.check_title(p["title"], p["keyword"])
            self.assertEqual(f, [], (p["no"], p["title"], f))

    def test_plan_titles_no_banned_terms(self):
        # §6.10 금지어 — banned-terms.ts 단일 출처를 preflight 파서로 읽는다. 제목엔 B등급(경고)도 두지 않는다.
        graded = preflight.parse_banned_terms()
        for p in nr.load_keywords()["plan"]:
            for grade, terms in graded.items():
                hit = [t for t, rx in terms if rx.search(p["title"])]
                self.assertEqual(hit, [], (p["no"], grade, hit))


class BodyTest(unittest.TestCase):
    def test_good_body_passes(self):
        f, n = nr.check_body(body())
        self.assertEqual(f, [], f)
        self.assertEqual(n, [])

    def test_tr2_our_length_fails(self):
        f, _ = nr.check_body(body(n_chars=2238))   # 10/7 글 실측
        self.assertTrue(any("2,500~3,500" in x for x in f), f)

    def test_too_long_fails(self):
        f, _ = nr.check_body(body(n_chars=3700))
        self.assertTrue(any("밖" in x for x in f), f)

    def test_faq_two_fails(self):
        f, _ = nr.check_body(body(faq=2))
        self.assertTrue(any("FAQ 질문 2개" in x for x in f), f)

    def test_faq_head_count_mismatch(self):
        f, _ = nr.check_body(body(faq=3, faq_head="자주 묻는 질문 4가지"))
        self.assertTrue(any("다르다" in x for x in f), f)

    def test_q_subheads_outside_faq_do_not_count(self):
        # 본문 소제목을 「Q. ~인가요」로 써도 FAQ 블록이 없으면 실패 — 블록 안의 Q. 만 센다
        text = "Q. 소제목인가요\nQ. 또 소제목인가요\nQ. 셋째인가요\n" + body(faq=0)
        f, _ = nr.check_body(text)
        self.assertTrue(any("FAQ 질문 0개" in x for x in f), f)

    def test_no_summary_fails(self):
        f, _ = nr.check_body(body(summary=False))
        self.assertTrue(any("핵심 요약" in x for x in f), f)

    def test_one_link_fails(self):
        f, _ = nr.check_body(body(links=(LINK_A,)))
        self.assertTrue(any("내부링크 1개" in x for x in f), f)

    def test_own_url_and_duplicates_not_counted(self):
        # osmu 가 붙이는 자기 본진 링크·같은 URL 반복은 내부링크가 아니다
        f, _ = nr.check_body(body(links=(LINK_A, LINK_A + "/", LINK_B)), own_urls=[LINK_B])
        self.assertTrue(any("내부링크 1개" in x for x in f), f)

    def test_diagnosis_url_not_internal(self):
        f, _ = nr.check_body(body(links=(LINK_A, "https://goodfinance.kr/diagnosis")))
        self.assertTrue(any("내부링크 1개" in x for x in f), f)

    def test_four_links_is_warning(self):
        f, n = nr.check_body(body(links=(LINK_A, LINK_B, LINK_C, LINK_D)))
        self.assertEqual(f, [])
        self.assertTrue(any("넘음" in x for x in n), n)


class MediaTest(unittest.TestCase):
    """규칙 5(표 1개 이상)·규칙 6(이미지 5~7) — TR3 결론 2(2026-10-14)."""

    def test_no_table_fails(self):
        f, _ = nr.check_body(body(table=()))
        self.assertTrue(any("표 0개" in x for x in f), f)

    def test_table_head_without_rows_not_counted(self):
        # 「[표1]」 줄만 있고 「|」 줄이 없으면 표가 아니다(그림으로 넣은 표 · ▶ 줄로 푼 표)
        f, _ = nr.check_body(body(table=["[표1] 제목만", "▶ 경우 · 값"]))
        self.assertTrue(any("표 0개" in x and "모자라" in x for x in f), f)

    def test_header_only_table_not_counted(self):
        self.assertEqual(nr.count_tables("[표1] 제목\n구분 | 값\n\n본문"), 0)
        self.assertEqual(nr.count_tables("[표1] 제목\n구분 | 값\n가 | 나\n\n[표2] 둘\nA | B\nC | D"), 2)

    def test_image_bounds(self):
        for n, ok in ((4, False), (5, True), (7, True), (8, False)):
            f, _ = nr.check_body(body(images=n))
            self.assertEqual(not any("이미지 자리" in x for x in f), ok, (n, f))

    def test_inline_image_mention_not_counted(self):
        # 문장 속 「[이미지①]」 언급·「[이미지①] 설명」 은 자리표시가 아니다 — 단독 줄만 센다
        self.assertEqual(nr.count_images("본문 [이미지①] 가운데\n[이미지②] 설명\n[이미지 3]\n [이미지④] \n[이미지]"), 3)

    def test_media_skippable(self):
        f, _ = nr.check_body(body(table=(), images=0), media=False)
        self.assertEqual(f, [], f)

    def test_real_drafts_pass_media(self):
        # 21·22·23호 등 저장소의 네이버 원고는 TR3 실측대로 표 1 · 이미지 5 — 새 검사가 이들을 막으면 검사가 틀린 것
        root = os.path.join(nr.ROOT, "assets", "naver")
        for slug in ("annuity-insurance-cancel-tax-keep-options", "noncovered-injection-silson-treatment-purpose",
                     "silson-duplicate-proportional-compensation"):
            p = os.path.join(root, slug, "naver.txt")
            with open(p, encoding="utf-8") as fp:
                text = fp.read()
            self.assertEqual(nr.check_media(text), [], slug)
            self.assertEqual((nr.count_tables(text), nr.count_images(text)), (1, 5), slug)


class ArticleTest(unittest.TestCase):
    def test_no_naver_skips(self):
        ok, d = nr.check_article({"slug": "x", "naver_title": "", "naver_blog_content": ""})
        self.assertTrue(ok)
        self.assertIn("생략", d)

    def test_registered_keyword_checked(self):
        data = {"articles": {"x": "부담보 해제"}, "plan": []}
        art = {"slug": "x", "naver_title": "그 부위로 병원에 가면 부담보 해제 후 실손에서 바로 보장되나요",
               "naver_blog_content": body()}
        ok, d = nr.check_article(art, data)
        self.assertFalse(ok)
        self.assertIn("맨 앞", d)

    def test_pass_article(self):
        data = {"articles": {"x": "부담보 해제"}, "plan": []}
        art = {"slug": "x", "naver_title": "부담보 해제 후 그 부위로 병원에 가면 실손에서 바로 보장되나요",
               "naver_blog_content": body()}
        ok, d = nr.check_article(art, data)
        self.assertTrue(ok, d)

    def test_media_blocks_new_draft(self):
        data = {"articles": {"x": "부담보 해제"}, "plan": []}
        art = {"slug": "x", "naver_title": "부담보 해제 후 그 부위로 병원에 가면 실손에서 바로 보장되나요",
               "naver_blog_content": body(images=3), "created_at": "2026-10-15T01:00:00+00:00"}
        ok, d = nr.check_article(art, data)
        self.assertFalse(ok)
        self.assertIn("이미지 자리 3개", d)

    def test_media_is_note_for_older_draft(self):
        # MEDIA_RULES_FROM 이전 초안(18~23호 등)은 표·이미지로 새로 막지 않는다 — 메모만
        data = {"articles": {"x": "부담보 해제"}, "plan": []}
        art = {"slug": "x", "naver_title": "부담보 해제 후 그 부위로 병원에 가면 실손에서 바로 보장되나요",
               "naver_blog_content": body(table=()), "created_at": "2026-10-12T01:00:00+00:00"}
        ok, d = nr.check_article(art, data)
        self.assertTrue(ok, d)
        self.assertIn("이전 초안이라 경고", d)


class PreflightWiringTest(unittest.TestCase):
    def test_frozen_naver_skipped(self):
        art = {"slug": "x", "naver_title": "짧다", "naver_blog_content": "짧다",
               "ad_reviews": [{"channel": "naver", "status": "approved"}]}
        ok, d = preflight.check_naver_rules(art)
        self.assertTrue(ok)
        self.assertIn("접수·승인", d)

    def test_unfrozen_fails(self):
        art = {"slug": "x", "naver_title": "짧다", "naver_blog_content": "짧다", "ad_reviews": [],
               "created_at": "2026-10-12T01:00:00+00:00"}
        ok, _ = preflight.check_naver_rules(art)
        self.assertFalse(ok)

    def test_rejected_naver_is_checked(self):
        # 반송분은 고쳐서 다시 내는 원고다 — 검사 대상
        art = {"slug": "x", "naver_title": "짧다", "naver_blog_content": "짧다",
               "ad_reviews": [{"channel": "naver", "status": "rejected"}], "created_at": "2026-10-12T01:00:00+00:00"}
        ok, _ = preflight.check_naver_rules(art)
        self.assertFalse(ok)

    def test_pre_rule_draft_is_warning(self):
        art = {"slug": "x", "naver_title": "짧다", "naver_blog_content": "짧다", "ad_reviews": [],
               "created_at": "2026-10-08T01:00:00+00:00"}
        ok, d = preflight.check_naver_rules(art)
        self.assertTrue(ok)
        self.assertTrue(d.startswith(preflight.WARN_PREFIX), d)


class DraftGateTest(unittest.TestCase):
    def setUp(self):
        import draft_insert
        self.di = draft_insert
        self.data = {"articles": {"x": "부담보 해제"}, "plan": []}
        self.row = {"slug": "x", "naver_title": "부담보 해제 후 그 부위로 병원에 가면 실손에서 바로 보장되나요",
                    "naver_blog_content": body()}

    def test_pass(self):
        self.assertEqual(self.di.naver_gate(self.row, self.data), ([], None))

    def test_unregistered_keyword_blocks(self):
        with self.assertRaises(self.di.kit.KitError) as c:
            self.di.naver_gate({**self.row, "slug": "y"}, self.data)
        self.assertIn("미등록", str(c.exception))

    def test_meta_keyword_used_when_unregistered(self):
        # 장부에 없는 새 글 — meta.json 의 naver_keyword 로 재고, 장부에 적을 키워드를 돌려준다
        self.assertEqual(self.di.naver_gate({**self.row, "slug": "y"}, self.data, meta_kw="부담보 해제"), ([], "부담보 해제"))

    def test_meta_keyword_still_measured(self):
        with self.assertRaises(self.di.kit.KitError) as c:
            self.di.naver_gate({**self.row, "slug": "y"}, self.data, meta_kw="실손보험 청구 거절")
        self.assertIn("키워드 낱말 빠짐", str(c.exception))

    def test_ledger_and_meta_mismatch_blocks(self):
        with self.assertRaises(self.di.kit.KitError) as c:
            self.di.naver_gate(self.row, self.data, meta_kw="부담보 해제 기간")
        self.assertIn("불일치", str(c.exception))

    def test_register_keyword_writes_ledger(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "kw.json")
            with open(p, "w", encoding="utf-8") as fp:
                json.dump({"_doc": "x", "articles": {"a": "가"}, "plan": [{"no": 1}]}, fp, ensure_ascii=False)
            self.di.register_keyword("y", "부담보 해제", p)
            with open(p, encoding="utf-8") as fp:
                got = json.load(fp)
        self.assertEqual(got["articles"], {"a": "가", "y": "부담보 해제"})
        self.assertEqual(got["plan"], [{"no": 1}])

    def test_no_table_blocks(self):
        with self.assertRaises(self.di.kit.KitError) as c:
            self.di.naver_gate({**self.row, "naver_blog_content": body(table=())}, self.data)
        self.assertIn("표 0개", str(c.exception))

    def test_short_body_blocks(self):
        with self.assertRaises(self.di.kit.KitError) as c:
            self.di.naver_gate({**self.row, "naver_blog_content": body(n_chars=2238)}, self.data)
        self.assertIn("2,500~3,500", str(c.exception))

    def test_no_basis_blocks(self):
        """CP1 — 10/20 법인 네이버판은 근거 문장이 없어 pams_auto 가 키트를 못 만들었다. 저장 단계에서 막는다."""
        with self.assertRaises(self.di.kit.KitError) as c:
            self.di.naver_gate({**self.row, "naver_blog_content": body(basis=None)}, self.data)
        self.assertIn("자료명이 하나도 없습니다", str(c.exception))

    def test_main_basis_must_carry_over(self):
        main = "## 소제목\n\n" + BASIS.replace("「상법 제662조(소멸시효)」", "「상법 제662조(소멸시효)」·「상법 제731조(타인의 생명의 보험)」")
        with self.assertRaises(self.di.kit.KitError) as c:
            self.di.naver_gate({**self.row, "main_website_markdown": main}, self.data)
        self.assertIn("상법 제731조(타인의 생명의 보험)", str(c.exception))
        self.assertEqual(self.di.naver_gate({**self.row, "main_website_markdown": BASIS}, self.data), ([], None))


class BannedVerbTest(unittest.TestCase):
    """preflight 가 banned-terms.ts 의 「미친」 정규식을 파이썬으로도 읽는다(가변 길이 lookbehind 면 글자 그대로로 떨어진다)."""

    def setUp(self):
        self.rx = dict(preflight.parse_banned_terms()["B"])["미친"]

    def test_verb_forms_clean(self):
        for s in ("금액에 못 미친다면", "영향을 미친다", "기준에 미친다는"):
            self.assertIsNone(self.rx.search(s), s)

    def test_adjective_hit(self):
        self.assertIsNotNone(self.rx.search("완전 미친 가성비"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
