#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""네이버 비공개 게시 안내 — 순수 부분 시험. python scripts/test_naver_private_guide.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
import naver_private_guide as g  # noqa: E402
import pams_kit as kit  # noqa: E402


class Steps(unittest.TestCase):
    def setUp(self):
        self.s = g.steps("7호", "제목 그대로", 3, "0930_7호_네이버비공개")

    def test_private_and_capture_rules(self):
        j = "\n".join(self.s)
        self.assertIn("「비공개」 → 발행", j)
        self.assertIn("「비공개」 표시가 화면에 보이게", j)
        self.assertIn("공란(제_____호) 그대로", j)
        self.assertIn("「7호」", j)                       # pams_auto 짝맞추기 = 파일명에 N호
        self.assertIn("저장 위치를 Downloads\\PAMS접수\\ 로", j)       # 저장만 하면 zip 자동
        self.assertIn("압축은 하지 않는다", j)
        self.assertIn("7호.pdf", j)

    def test_keyword_example_from_title(self):
        self.assertEqual(g.keyword_of("백내장 실비 청구했는데 통원으로만 나왔다면 — 입원 필요성이 기록에 남아야 합니다"), "백내장")
        s = "\n".join(g.steps("10호", "백내장 실비 청구했는데 통원으로만 나왔다면", 3, "b"))
        self.assertIn("핵심어(예: 백내장)", s)
        self.assertIn("백내장.pdf", s)

    def test_title_only_once_in_a_box(self):
        """2026-10-01 7호: 제목처럼 보이는 줄이 둘이라 헷갈렸다 — 제목은 맨 위 상자 하나뿐, 할 일 목록에는 다시 쓰지 않는다."""
        self.assertFalse(any("제목 그대로" in l for l in self.s), "할 일 목록에 제목을 다시 쓰지 않는다")
        box = g.title_box("제목 그대로")
        self.assertEqual(box[0], g.TITLE_BOX)
        self.assertEqual(sum(1 for l in box if l.strip() == "제목 그대로"), 1)
        self.assertIn("📄", box[-1])                     # 본문 끝 본진 링크 줄은 제목이 아님
        j = "\n".join(self.s)
        self.assertIn("맨 위 상자의 제목", j)
        self.assertIn("따옴표 문장은 본문 첫 줄이니 지우지 않는다", j)
        self.assertIn("자리표시 줄([이미지…])만 지운다", j)
        self.assertNotIn("**", j, "png·txt 에 마크다운 별표가 그대로 찍힌다")
        # 한 장 png 는 들여쓴 보조 줄을 싣지 않는다 — 첫 줄 경고는 번호 줄 안에 있어야 png 에도 나온다
        h = g.one_page_html("7호", "slug", "제목", self.s, 3)
        self.assertIn("본문 첫 줄이니 지우지 않는다", h)

    def test_title_trailing_punct_refused(self):
        self.assertEqual(g.check_title(" 제목 "), "제목")
        for t in ("제목.", "제목?", "제목…", ""):
            with self.assertRaises(kit.KitError):
                g.check_title(t)

    def test_one_page_title_box(self):
        h = g.one_page_html("7호", "slug", "부모님 제목", self.s, 3)
        self.assertEqual(h.count("부모님 제목"), 1)
        self.assertIn("제목 칸에 붙여 넣을 제목", h)

    def test_images(self):
        self.assertTrue(any("사진 3장" in l for l in self.s))
        self.assertTrue(any("사진 없음" in l for l in g.steps("7호", "t", 0, "b")))

    def test_out_dir_not_capture_folder(self):
        # PAMS접수 바로 아래 png/pdf 는 pams_auto 가 네이버 캡처로 짝짓는다 — 하위 폴더여야 한다
        self.assertNotEqual(os.path.normcase(g.OUT_DIR), os.path.normcase(kit.KIT_DIR))
        self.assertEqual(os.path.normcase(os.path.dirname(g.OUT_DIR)), os.path.normcase(kit.KIT_DIR))

    def test_one_page_no_double_numbering(self):
        h = g.one_page_html("7호", "slug", "제목", self.s, 3)
        self.assertNotIn("<li>1. ", h)
        self.assertEqual(h.count("<li>"), sum(1 for l in self.s if not l.startswith(" ")))

    def test_naver_only_box_has_no_main_link_line(self):
        self.assertIn("줄은 본진 글 링크", g.title_box("t")[-1])
        self.assertIn("본진 글 링크 줄(📄)은 없다", g.title_box("t", naver_only=True)[-1])

    def test_existing_outputs_stop_before_overwrite(self):
        """SH16 — 관제탑이 손으로 만든 1012_18호_네이버비공개.* 가 있으면 build 가 compose 전에 멈춘다(--force 만 덮어씀)."""
        import tempfile
        d = tempfile.mkdtemp()
        base = "1012_18호_네이버비공개"
        for n in (base + ".txt", base + "_이미지1.png", base + "_안내.png", "1012_18호_네이버.zip", base + "X.txt"):
            open(os.path.join(d, n), "w").write("x")
        self.assertEqual(g.existing_outputs(d, base), [base + ".txt", base + "_안내.png", base + "_이미지1.png"])
        self.assertEqual(g.existing_outputs(d, "1012_19호_네이버비공개"), [])

        class Boom:
            def __getattr__(self, k):
                raise AssertionError("compose 서버를 부르면 안 된다")
        old = g.kit.kit_basename
        g.kit.kit_basename = lambda slug, ch, now=None: "1012_18호_네이버"
        try:
            with self.assertRaises(kit.KitError) as cm:
                g.build({}, {"slug": "silson-claim-deadline-3year-start-point", "id": "x"}, Boom(), out_dir=d)
            self.assertIn("덮어쓰지 않았습니다", str(cm.exception))
        finally:
            g.kit.kit_basename = old
        self.assertEqual(open(os.path.join(d, base + ".txt")).read(), "x")

    def test_heading_gate(self):
        """NF1 — 24호 html 이 24px 소제목 0개로 조용히 나갔다. 원고 소제목보다 적으면 멈춘다."""
        fix = os.path.join(kit.ROOT, "src", "lib", "__fixtures__", "naver-rich")
        for no in ("22", "23"):
            text = open(os.path.join(fix, no + ".txt"), encoding="utf-8").read()
            gold = open(os.path.join(fix, no + ".html"), encoding="utf-8").read()
            heads = g.source_headings(text)
            self.assertEqual(len(heads), gold.count("font-size:24px"), heads)   # 손작업 정답본과 같은 수
            self.assertIn("알아두실 용어 4가지", heads)                          # 밑에 본문이 붙어도 소제목
            self.assertEqual(g.check_rich_headings(text, gold), len(heads))
        text = open(os.path.join(fix, "24.txt"), encoding="utf-8").read()
        self.assertEqual(len(g.source_headings(text)), 10)
        self.assertNotIn("같은 문장 뒤에 \"다만\"이 붙습니다.", g.source_headings(text))
        old = '<p style="font-size:19px;">알아두실 용어 4가지</p>'               # 고치기 전 24호 html 모양
        with self.assertRaises(kit.KitError) as cm:
            g.check_rich_headings(text, old)
        self.assertIn("산출물을 만들지 않았습니다", str(cm.exception))

    def test_banner_step_in_guide(self):
        j = "\n".join(self.s)
        self.assertIn("마지막 카톡 배너 — 채팅 링크 직접 걸기, 캡처 전에", j)
        self.assertLess(j.index("카톡 배너"), j.index("캡처한다"))          # 캡처 전에
        h = g.one_page_html("7호", "slug", "제목", self.s, 3, "보험 리모델링")
        self.assertIn("마지막 카톡 배너", h)
        self.assertIn("분류: 보험 리모델링", h)
        self.assertNotIn("분류:", g.one_page_html("7호", "slug", "제목", self.s, 3))

    def test_robert_todo_and_proof_png_step(self):
        """SUP3m — 10/25 반송 「비공개 상태임이 확인되도록 캡처」 → 글 상단 캡처 png 가 할 일 ④."""
        self.assertEqual(g.ROBERT_TODO, "로버트 할 일: ① 카톡 배너 링크 걸기 ② 비공개 게시 ③ PDF 저장 "
                                        "④ 글 상단 캡처 png 저장(비공개 표시 보이게)")
        h = g.one_page_html("7호", "slug", "제목", self.s, 3)
        self.assertIn(g.ROBERT_TODO, h)
        self.assertLess(h.index(g.ROBERT_TODO), h.index("<ol"), "할 일 4가지는 목록 위에")
        j = "\n".join(self.s)
        self.assertIn("「· 비공개」 표시가 보이게", j)
        self.assertIn("7호_상단.png", j)
        self.assertIn("png 없으면 만들지 않고 알림", j)
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "naver_private_guide.py"), encoding="utf-8").read()
        self.assertIn('f"분류: {category}", ROBERT_TODO', src, "txt 머리에도 싣는다")
        self.assertIn('f"{ROBERT_TODO}\\n"', src, "텔레그램 캡션에도 싣는다")

    def test_banner_copy_and_append(self):
        import tempfile
        d = tempfile.mkdtemp()
        src = os.path.join(d, "src.png")
        open(src, "wb").write(b"PNG")
        base = "1026_30호_네이버비공개"
        name = g.copy_banner(d, base, src)
        self.assertEqual(name, base + "_카톡배너.png")
        self.assertEqual(open(os.path.join(d, name), "rb").read(), b"PNG")
        with self.assertRaises(kit.KitError):
            g.copy_banner(d, base, os.path.join(d, "없음.png"))
        out = g.append_banner('<p>x</p><img src="a_이미지5.png">\n', name)
        self.assertTrue(out.rstrip().endswith(">"))
        self.assertLess(out.index("a_이미지5.png"), out.index(name))     # 진단 CTA 이미지 다음
        self.assertNotIn("<a ", out)                                     # 링크는 넣지 않는다
        self.assertEqual(g.existing_outputs(d, base), [name])

    def test_blog_category(self):
        c = g.blog_category
        self.assertEqual(c("건강검진 재검 권유받았다면 계약 전 알릴 의무는 어디까지인가", "건강검진 재검 고지"), "실손·보장성 가이드")
        self.assertEqual(c("부담보 조건부 가입 전에 확인할 것", ""), "실손·보장성 가이드")
        self.assertEqual(c("기존 계약 리모델링, 담보를 합산해 보면", ""), "보험 리모델링")
        self.assertEqual(c("백내장 보험금 청구했는데 지급 심사에서", ""), "보험금 청구·보상")
        self.assertEqual(c("연금 개시 전 세액공제와 노후 설계", ""), "연금·노후·세테크")
        self.assertEqual(c("보험료 절감 방법 — 할인 특약", ""), "보험료 절약·꿀팁")
        self.assertEqual(c("오늘의 일상", "", "본문"), g.CATEGORY_UNSURE)          # 근거 없음
        self.assertEqual(c("고지 청구", ""), g.CATEGORY_UNSURE)                    # 동점
        # 본문만으로는 제목 근거 없이 정하지 않는다(본문 가중 최대 3 → 한 칸 3점 이상이어야 하나 동점 방지용)
        self.assertEqual(c("제목", "", "연금 연금 연금 연금"), "연금·노후·세테크")

    def test_format_line(self):
        self.assertIn("configs/naver-format.json", g.format_line())
        self.assertNotIn("읽기 실패", g.format_line())


if __name__ == "__main__":
    unittest.main(verbosity=1)
