#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PAMS 키트 자동 생성 판정 테스트 — python scripts/test_pams_auto.py

DB·빌드·서버·텔레그램은 가짜로 바꿔 끼우고 「언제 만들고 언제 건너뛰는가」만 고정한다.
"""
import os
import sys
import tempfile
import unittest
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_auto as auto  # noqa: E402
import pams_kit as kit  # noqa: E402

auto.log = lambda msg: None  # 테스트 중 로그 파일을 쓰지 않는다


def art(slug="ltc-grade-home-care-rider-check", body="본문", acks=None, reviews=None, **kw):
    a = {"id": slug, "slug": slug, "title": "제목", "naver_title": "부모님 장기요양등급 나왔다면",
         "main_website_markdown": body, "naver_blog_content": "네이버 " + body, "raw_source_name": "출처",
         "compliance_acks": acks or [], "ad_reviews": reviews or [],
         "is_main_published": False, "is_naver_published": False}
    a.update(kw)
    return a


class Harness:
    def __init__(self, main=None, naver=None, gate_blocked=()):
        self.drafts = {"main": main or [], "naver": naver if naver is not None else (main or [])}
        self.gate_blocked = set(gate_blocked)
        self.fail = None  # 게이트 아닌 실패 문구(자료명 못 찾음 등)
        self.tries = 0
        self.built, self.notes, self.proofs = [], [], []
        self.dir = tempfile.mkdtemp()
        self.state = {"kits": {}, "gate_blocked": {}, "captures": {}}

    def fetch(self, ch):
        return self.drafts[ch]

    def build(self, env, a, ch, capture=None, server=None, out_dir=None, proof=None):
        self.proofs.append(proof)
        if a["slug"] in self.gate_blocked:
            raise kit.KitError("확인 미완료", gate=True)
        self.tries += 1
        if self.fail:
            raise kit.KitError(self.fail)
        name = kit.kit_basename(a["slug"], ch, datetime(2026, 9, 29, tzinfo=kit.KST))
        z = os.path.join(out_dir, name + ".zip")
        for path, body in ((z, "zip"), (z[:-4] + ".txt", "txt")):
            with open(path, "w", encoding="utf-8") as fp:
                fp.write(body)
        self.built.append((a["slug"], ch, capture))
        return {"zip": z, "txt": z[:-4] + ".txt", "name": name + ".zip", "title": "게시명",
                "slug": a["slug"], "channel": ch, "article_title": "장기요양 등급 받았는데 — 부제",
                "sources": ["국민건강보험공단, 자료, 2026, 2026.3.17"], "files": [], "hash": kit.content_hash(a, ch)}

    def run(self):
        return auto.run_once({}, self.state, self.fetch, self.build, self.notes.append, kit_dir=self.dir)


class NamingTest(unittest.TestCase):
    def test_name_with_issue_number(self):
        d = datetime(2026, 9, 29, tzinfo=kit.KST)
        self.assertEqual(kit.kit_basename("ltc-grade-home-care-rider-check", "main", d), "0929_7호_본진")
        self.assertEqual(kit.kit_basename("caregiver-daily-benefit-support-vs-use", "naver", d), "0929_6호_네이버")

    def test_name_without_issue_number_falls_back_to_slug(self):
        d = datetime(2026, 10, 1, tzinfo=kit.KST)
        self.assertEqual(kit.kit_basename("new-draft", "main", d), "1001_new-draft_본진")

    def test_kit_dir_is_downloads(self):
        self.assertTrue(kit.KIT_DIR.endswith(os.path.join("Downloads", "PAMS접수")))


class MainKitTest(unittest.TestCase):
    def test_new_draft_builds_once(self):
        h = Harness(main=[art()])
        self.assertEqual(len(h.run()), 1)
        self.assertEqual(len(h.run()), 0, "원고가 같으면 다시 만들지 않는다")
        self.assertEqual(len(h.notes), 1)
        # 글 제목이 앞, 호수는 괄호(로버트 2026-09-30) — 키트 파일명은 그대로 뒤에
        self.assertTrue(h.notes[0].startswith("장기요양 등급 받았는데 (7호) 본진 키트 준비됨 — 0929_7호_본진.zip"), h.notes[0])
        self.assertIn("PAMS 게시명: 게시명 / 자료명: 국민건강보험공단", h.notes[0])

    def test_content_change_rebuilds(self):
        h = Harness(main=[art(body="v1")])
        h.run()
        h.drafts["main"] = [art(body="v2")]
        self.assertEqual(len(h.run()), 1, "원고가 바뀌면 다시 만든다")

    def test_missing_file_rebuilds(self):
        h = Harness(main=[art()])
        k = h.run()[0]
        os.remove(k["zip"])
        self.assertEqual(len(h.run()), 1, "키트 파일이 없어졌으면 다시 만든다")

    def test_stale_kit_rebuilds_even_if_content_same(self):
        h = Harness(main=[art()])
        h.run()
        need, why = auto.needs_main_kit(h.drafts["main"][0], h.state, is_stale=lambda z: True)
        self.assertTrue(need, "brand.ts 등이 키트보다 새로우면 원고가 같아도 다시 만든다")
        self.assertIn("오래됨", why)
        need, _ = auto.needs_main_kit(h.drafts["main"][0], h.state, is_stale=lambda z: False)
        self.assertFalse(need)

    def test_gate_blocked_is_skipped_and_not_retried_until_acks_change(self):
        h = Harness(main=[art()], gate_blocked={"ltc-grade-home-care-rider-check"})
        self.assertEqual(h.run(), [])
        self.assertEqual(h.built, [])
        self.assertEqual(h.notes, [], "게이트 막힘은 알림하지 않는다(10분마다 울리지 않게)")
        need, why = auto.needs_main_kit(art(), h.state)
        self.assertFalse(need, "원고·확인 이력이 그대로면 서버를 다시 띄우지 않는다")
        need, _ = auto.needs_main_kit(art(acks=[{"field": "x", "term": "15%", "offset": 1}]), h.state)
        self.assertTrue(need, "확인 이력이 바뀌면 다시 시도한다")

    def test_same_non_gate_failure_alerts_once_and_retries_when_sources_change(self):
        """SK1 — 자료명 못 찾음 같은 게이트 아닌 실패가 10분마다 같은 알림을 보냈다(2026-10-20 법인편)."""
        d = tempfile.mkdtemp()
        src = os.path.join(d, "sources.json")
        open(src, "w", encoding="utf-8").write('{"sources": []}')
        saved = kit.SOURCES_JSON
        kit.SOURCES_JSON = src
        try:
            h = Harness(main=[art()])
            h.fail = "본문에서 configs/sources.json 의 자료명을 찾지 못했습니다"
            h.run()
            h.run()
            self.assertEqual(h.tries, 1, "같은 원고·같은 sources.json 이면 다시 시도하지 않는다")
            self.assertEqual(len(h.notes), 1, "같은 실패는 한 번만 알린다")
            h.drafts["main"] = [art(body="v2")]
            h.run()
            self.assertEqual(h.tries, 2, "원고가 바뀌면 다시 시도한다")
            self.assertEqual(len(h.notes), 2)
            open(src, "w", encoding="utf-8").write('{"sources": [{"title": "새 자료"}]}')
            h.fail = None
            self.assertEqual(len(h.run()), 1, "sources.json 이 바뀌면 다시 시도한다")
            self.assertNotIn("ltc-grade-home-care-rider-check|main", h.state.get("failed", {}), "성공하면 실패 기록을 지운다")
        finally:
            kit.SOURCES_JSON = saved

    def test_slots_full_holds_ready_and_fail_alerts(self):
        """SK2 — 업무광고 칸 3개가 다 심사중이면 키트는 만들되 「준비됨」·「실패」 알림은 보류한다(2026-10-20 로버트)."""
        h = Harness(main=[art()])
        made = auto.run_once({}, h.state, h.fetch, h.build, h.notes.append, kit_dir=h.dir, hold_alerts=True)
        self.assertEqual(len(made), 1, "키트는 미리 만들어 둔다")
        self.assertEqual(h.notes, [], "칸이 다 찼으면 준비됨 알림을 보내지 않는다")
        held = h.state["held_kits"]["ltc-grade-home-care-rider-check|main"]
        self.assertEqual(held["zip"], made[0]["zip"])
        self.assertIn("(7호) 본진", held["label"])
        self.assertEqual(auto.run_once({}, h.state, h.fetch, h.build, h.notes.append, kit_dir=h.dir, hold_alerts=True), [],
                         "다음 바퀴에 다시 만들지 않는다")

        d = tempfile.mkdtemp()
        src = os.path.join(d, "sources.json")
        open(src, "w", encoding="utf-8").write('{"sources": []}')
        saved, kit.SOURCES_JSON = kit.SOURCES_JSON, src
        try:
            f = Harness(main=[art()])
            f.fail = "본문에서 configs/sources.json 의 자료명을 찾지 못했습니다"
            for _ in range(2):
                auto.run_once({}, f.state, f.fetch, f.build, f.notes.append, kit_dir=f.dir, hold_alerts=True)
            self.assertEqual(f.notes, [], "칸이 다 찼으면 실패 알림도 보내지 않는다")
            self.assertEqual(f.tries, 1, "같은 실패는 다시 시도하지 않는다")
            self.assertIn("자료명을 찾지 못했습니다", f.state["held_kits"]["ltc-grade-home-care-rider-check|main"]["why"])
        finally:
            kit.SOURCES_JSON = saved

    def test_not_full_sends_as_before_and_clears_held(self):
        h = Harness(main=[art()])
        h.state["held_kits"] = {"ltc-grade-home-care-rider-check|main": {"label": "x", "why": "옛 실패"}}
        h.run()
        self.assertEqual(len(h.notes), 1, "칸이 있으면 종전대로 바로 알린다")
        self.assertEqual(h.state["held_kits"], {}, "바로 알렸으면 보류 목록에서 뺀다")

    def test_main_checks_slots_before_run_once(self):
        src = open(os.path.join(HERE, "pams_auto.py"), encoding="utf-8").read()
        i = src.index("pams_queue.slots_full(env)")
        self.assertLess(i, src.index("made = run_once("))
        self.assertIn("full = False", src[i:i + 300], "칸 수를 못 읽으면 알림을 보류하지 않는다")
        self.assertIn("hold_alerts=full", src)

    def test_ack_then_build(self):
        h = Harness(main=[art()], gate_blocked={"ltc-grade-home-care-rider-check"})
        h.run()
        h.gate_blocked.clear()
        h.drafts["main"] = [art(acks=[{"field": "x", "term": "15%", "offset": 1}])]
        self.assertEqual(len(h.run()), 1)

    def test_naver_only_gets_no_main_kit(self):
        """SH16 — 네이버 단독(main_website_markdown NULL·빈칸)은 본진 키트를 만들지 않는다. 네이버 캡처 짝은 그대로."""
        for body in (None, "", "  \n"):
            need, why = auto.needs_main_kit(art(main_website_markdown=body), {"kits": {}, "gate_blocked": {}})
            self.assertFalse(need, repr(body))
            self.assertIn("네이버 단독", why)
        h = Harness(main=[art(main_website_markdown=None)])
        self.assertEqual(h.run(), [])
        self.assertEqual(h.built, [])
        cap = os.path.join(h.dir, "7호.pdf")
        open(cap, "wb").write(b"img")
        with open(os.path.join(h.dir, "7호_비공개.png"), "wb") as fp:
            fp.write(b"png")
        self.assertEqual(len(h.run()), 1)
        self.assertEqual([(s, c) for s, c, _ in h.built], [("ltc-grade-home-care-rider-check", "naver")])

    def test_published_or_submitted_is_skipped(self):
        h = Harness(main=[art(is_main_published=True),
                          art(slug="caregiver-daily-benefit-support-vs-use",
                              reviews=[{"channel": "main", "status": "submitted"}])])
        self.assertEqual(h.run(), [])


class CaptureTest(unittest.TestCase):
    def cap(self, h, name, body=b"img"):
        p = os.path.join(h.dir, name)
        with open(p, "wb") as fp:
            fp.write(body)
        return p

    def proof(self, h, name="부모님 장기요양등급 나왔다면 비공개.png", body=b"png"):
        """블로그 화면 상단 「· 비공개」 캡처 — 이름은 글 제목(또는 slug·PDF 이름)으로 시작."""
        return self.cap(h, name, body)

    def test_single_waiting_article_pairs_without_hint(self):
        h = Harness(main=[], naver=[art()])
        self.cap(h, "스크린샷 2026-09-29.pdf")
        self.proof(h)
        made = h.run()
        self.assertEqual([(s, c) for s, c, _ in h.built], [("ltc-grade-home-care-rider-check", "naver")])
        self.assertTrue(os.path.exists(os.path.join(h.dir, auto.DONE_DIR_NAME, "스크린샷 2026-09-29.pdf")))
        self.assertTrue(h.notes[-1].startswith("장기요양 등급 받았는데 (7호) 네이버 키트 준비됨 — 0929_7호_네이버.zip"), h.notes[-1])
        self.assertEqual(len(made), 1)
        self.assertEqual(h.run(), [], "처리한 캡처는 다시 쓰지 않는다")

    def test_issue_number_in_filename_picks_that_article(self):
        h = Harness(main=[], naver=[art(), art(slug="caregiver-daily-benefit-support-vs-use", naver_title="간병")])
        self.cap(h, "7호 네이버 캡처.pdf")
        self.proof(h, "7호 네이버 캡처_상단.png")
        h.run()
        self.assertEqual(h.built[0][0], "ltc-grade-home-care-rider-check")

    def test_keyword_in_filename_matches_single_owner(self):
        """「백내장.pdf」처럼 핵심어만 있어도, 그 말이 대기 글 한 편의 제목에만 있으면 짝이 맞는다(2026-09-30 실측 보완)."""
        c = [art(), art(slug="cataract-x", title="백내장 수술 실비, 입원으로 받을까", naver_title="백내장 실비 청구했는데 통원으로만 나왔다면"),
             art(slug="manual-x", title="도수치료 실비, 앞으로도 계속 나올까", naver_title="도수치료 실비 청구되나요")]
        for fn, want in (("백내장.pdf", "cataract-x"), ("백내장 실비.pdf", "cataract-x"), ("도수치료.pdf", "manual-x"),
                         ("네이버 비공개 백내장 0930.pdf", "cataract-x")):
            a, why = auto.match_capture(fn, c)
            self.assertIsNotNone(a, fn)
            self.assertEqual(a["slug"], want, fn)
            self.assertEqual(why, "파일명 핵심어 일치")

    def test_shared_or_generic_word_does_not_match(self):
        c = [art(slug="cataract-x", title="백내장 수술 실비", naver_title="백내장 실비 청구했는데"),
             art(slug="manual-x", title="도수치료 실비", naver_title="도수치료 실비 청구되나요")]
        for fn in ("실비.pdf", "0930.pdf", "스크린샷 2026-09-30.png", "청구.pdf"):
            a, why = auto.match_capture(fn, c)
            self.assertIsNone(a, fn)      # 두 글에 다 있거나 날짜·일반어 → 묻는다
        a, why = auto.match_capture("백내장 도수치료.pdf", c)
        self.assertIsNone(a)
        self.assertIn("여러 글", why)

    def test_17ho_does_not_match_7ho(self):
        a, why = auto.match_capture("17호.png", [art(), art(slug="caregiver-daily-benefit-support-vs-use")])
        self.assertIsNone(a)

    def test_ambiguous_asks_once_and_builds_nothing(self):
        h = Harness(main=[], naver=[art(), art(slug="caregiver-daily-benefit-support-vs-use", naver_title="간병")])
        self.cap(h, "캡처.pdf")
        self.assertEqual(h.run(), [])
        self.assertEqual(h.built, [])
        self.assertEqual(len(h.notes), 1)
        self.assertIn("짝을 못 정했습니다", h.notes[0])
        h.run()
        self.assertEqual(len(h.notes), 1, "같은 이유로 두 번 묻지 않는다")

    def test_no_waiting_article_asks(self):
        h = Harness(main=[], naver=[])
        self.cap(h, "캡처.pdf")
        h.run()
        self.assertIn("네이버 대기 글이 없음", h.notes[0])

    def test_locked_naver_is_not_a_candidate(self):
        locked = art(reviews=[{"channel": "naver", "status": "submitted"}])
        h = Harness(main=[], naver=[locked])
        self.cap(h, "7호.pdf")
        self.proof(h)
        h.run()
        self.assertEqual(h.built, [])

    def test_mismatched_capture_notified_once_then_new_file_retried(self):
        """제목·첫 줄이 원고와 다른 캡처(2026-10-01 7호) — zip 을 만들지 않고 한 번만 알린다. 다른 이름으로 다시 저장하면 다시 본다."""
        h = Harness(main=[], naver=[art()])
        real_build = h.build

        def build(env, a, ch, capture=None, server=None, out_dir=None, proof=None):
            if capture and os.path.basename(capture) == "7호.pdf":
                raise kit.KitError("제목 불일치: 기대 「A」 / 실제 「A.」(끝 문장부호)")
            return real_build(env, a, ch, capture=capture, server=server, out_dir=out_dir, proof=proof)
        h.build = build
        p = self.cap(h, "7호.pdf")
        self.proof(h)
        self.assertEqual(h.run(), [])
        self.assertEqual(len(h.notes), 1)
        self.assertIn("제목 불일치", h.notes[0])
        self.assertTrue(os.path.exists(p), "틀린 캡처는 처리됨으로 옮기지 않는다")
        self.assertEqual(h.run(), [])
        self.assertEqual(len(h.notes), 1, "같은 캡처로 바퀴마다 다시 알리지 않는다")
        self.cap(h, "7호_수정.pdf")
        self.assertEqual(len(h.run()), 1, "고쳐서 새 이름으로 저장하면 키트를 만든다")

    def test_handmade_zip_with_same_name_is_not_overwritten(self):
        """SH16 — 관제탑이 손으로 묶은 「MMDD_N호_네이버.zip」이 있으면 덮어쓰지 않고 한 번 알린다. 캡처는 그대로 둔다."""
        h = Harness(main=[], naver=[art()])
        manual = os.path.join(h.dir, kit.kit_basename("ltc-grade-home-care-rider-check", "naver") + ".zip")
        open(manual, "w").write("손으로 만든 키트")
        p = self.cap(h, "7호.pdf")
        self.assertEqual(h.run(), [])
        self.assertEqual(h.built, [])
        self.assertEqual(open(manual).read(), "손으로 만든 키트")
        self.assertTrue(os.path.exists(p))
        self.assertEqual(len(h.notes), 1)
        self.assertIn("이미 있어 만들지 않았습니다", h.notes[0])
        h.run()
        self.assertEqual(len(h.notes), 1, "같은 캡처로 바퀴마다 다시 알리지 않는다")

    def test_own_kit_same_name_is_rebuilt(self):
        """이 기계가 만든(상태에 기록된) 같은 이름 키트는 원고가 바뀌면 다시 만든다 — 막는 건 손으로 만든 것만."""
        st = {"kits": {}, "gate_blocked": {}, "captures": {}}
        d = tempfile.mkdtemp()
        a = art()
        z = os.path.join(d, kit.kit_basename(a["slug"], "main") + ".zip")
        open(z, "w").write("auto")
        self.assertEqual(auto.name_taken(a, "main", st, d), os.path.basename(z))
        st["kits"][f"{a['slug']}|main"] = {"zip": z}
        self.assertIsNone(auto.name_taken(a, "main", st, d))

    def test_gate_blocked_capture_waits(self):
        h = Harness(main=[], naver=[art()], gate_blocked={"ltc-grade-home-care-rider-check"})
        p = self.cap(h, "7호.pdf")
        self.proof(h)
        h.run()
        self.assertTrue(os.path.exists(p), "게이트에 막히면 캡처를 그대로 둔다")
        self.assertEqual(h.run(), [])
        self.assertEqual(len(h.built), 0)


class PrivateProofTest(unittest.TestCase):
    """SUP3m — 네이버 키트에 비공개 상태 증빙 그림 필수(10/25 연금·건강검진 반송)."""
    TITLE = "건강검진 재검 고지, 결과가 정상이어도 질문에 해당하나요?"
    MSG = "비공개 표시가 보이게 글 상단 캡처(png)도 같은 폴더에 저장해 주세요 — "

    def setUp(self):
        self.h = Harness(main=[], naver=[art(slug="health-checkup-retest-recommendation-disclosure", naver_title=self.TITLE)])

    def put(self, name, body=b"x"):
        p = os.path.join(self.h.dir, name)
        with open(p, "wb") as fp:
            fp.write(body)
        return p

    def test_pdf_without_proof_alerts_once_then_builds_when_png_arrives(self):
        h = self.h
        self.put("health-checkup-retest-recommendation-disclosure.pdf")
        self.assertEqual(h.run(), [])
        self.assertEqual(h.built, [], "증빙 그림 없이는 키트를 만들지 않는다")
        self.assertEqual(len(h.notes), 1)
        self.assertIn(self.MSG + self.TITLE, h.notes[0])
        h.run()
        self.assertEqual(len(h.notes), 1, "같은 PDF 로는 다시 알리지 않는다")
        # 로버트가 블로그 상단 캡처를 제목 이름으로 저장(? 는 파일 이름에 못 쓴다)
        png = self.put("건강검진 재검 고지, 결과가 정상이어도 질문에 해당하나요.png")
        self.assertEqual(len(h.run()), 1)
        self.assertEqual(h.proofs[-1], png, "증빙 그림을 build 에 넘긴다")
        done = os.path.join(h.dir, auto.DONE_DIR_NAME)
        self.assertEqual(sorted(os.listdir(done)), sorted(["health-checkup-retest-recommendation-disclosure.pdf",
                                                           os.path.basename(png)]), "PDF·증빙 둘 다 처리됨으로")

    def test_png_alone_is_not_a_capture(self):
        """10/26 실측 — 제목 이름 증빙 png 가 캡처로 잡혀 그림 하나로 키트를 만들려 했다."""
        h = self.h
        self.put("건강검진 재검 고지, 결과가 정상이어도 질문에 해당하나요.png")
        self.assertEqual(h.run(), [])
        self.assertEqual(h.built, [])
        self.assertEqual(h.notes, [], "그림만 있으면 묻지도 않는다(PDF 를 기다린다)")

    def test_same_name_new_file_is_reprocessed_unchanged_is_not(self):
        """10/25 실측 — status=done 이면 같은 이름 새 PDF 를 건너뛰었다. 이제 sig 가 바뀌면 다시 본다."""
        h = self.h
        self.put("건강검진.pdf")
        self.put("health-checkup-retest-recommendation-disclosure_상단.png")
        self.assertEqual(len(h.run()), 1)
        p = self.put("건강검진.pdf", b"new version longer")
        self.put("health-checkup-retest-recommendation-disclosure_상단.png", b"new png")
        self.assertEqual(len(h.run()), 1, "같은 이름이라도 새 파일이면 다시 만든다")
        self.assertFalse(os.path.exists(p))
        done = os.listdir(os.path.join(h.dir, auto.DONE_DIR_NAME))
        self.assertIn("건강검진_2.pdf", done, "처리됨 폴더의 옛 파일을 덮지 않는다")
        # 같은 파일(sig 같음)이 맨 위에 남아 있으면 다시 쓰지 않는다
        q = self.put("건강검진.pdf", b"third")
        h.state["captures"]["건강검진.pdf"]["sig"] = auto.file_sig(q)
        self.assertEqual(auto.list_captures(h.dir, h.state), [])

    def test_find_proof_by_title_slug_or_pdf_name_latest_wins(self):
        d = self.h.dir
        a = self.h.drafts["naver"][0]
        cap = self.put("7호.pdf")
        self.assertIsNone(auto.find_proof(d, cap, a))
        self.put("다른 글 상단.png")
        self.put("17호 상단.png")
        self.put("7호_네이버_1-thumb.png")   # 본문 사진은 증빙이 아니다
        self.assertIsNone(auto.find_proof(d, cap, a), "제목·slug·PDF 이름으로 시작하지 않으면 증빙이 아니다(17호 ≠ 7호)")
        old = self.put("7호 상단.png")
        os.utime(old, (1, 1))
        new = self.put("health-checkup-retest-recommendation-disclosure.jpg")
        self.assertEqual(auto.find_proof(d, cap, a), new, "여럿이면 가장 최근 것")
        os.remove(new)
        self.assertEqual(auto.find_proof(d, cap, a), old)
        v2 = self.put("7호_v2.pdf")
        self.assertEqual(auto.find_proof(d, v2, a), old, "_v2·_수정 PDF 도 원래 이름 증빙과 짝")


class ThreadsKitPickTest(unittest.TestCase):
    def test_pick(self):
        metas = [("a.zip", {"slug": "s", "row_id": None, "created": "2026-09-29T10"}),
                 ("b.zip", {"slug": "s", "row_id": "r1", "created": "2026-09-29T11"}),
                 ("c.zip", {"slug": "other", "row_id": None, "created": "2026-09-29T12"})]
        self.assertEqual(auto.pick_threads_kit(metas, "s", "r1"), "b.zip", "같은 행 id 키트, 최근 것")
        self.assertEqual(auto.pick_threads_kit(metas, "s", "r2"), "a.zip", "다른 행 id 키트는 못 쓴다(utm 불일치)")
        self.assertIsNone(auto.pick_threads_kit(metas, "none", "r1"))


class Telegram(unittest.TestCase):
    """2026-10-01 — 보낸 기록이 없어 「제대로 들어오는지」 답할 수 없었다 · 예외 문구에 토큰 URL 이 샐 수 있었다."""

    def setUp(self):
        self.logs = []
        self._log, self._post = auto.log, auto.requests.post
        auto.log = lambda m: self.logs.append(m)

    def tearDown(self):
        auto.log, auto.requests.post = self._log, self._post

    def test_success_and_failure_are_logged_with_first_line(self):
        class R:
            def __init__(self, ok, code=200):
                self.ok, self.status_code, self._ok = ok, code, ok
            def json(self):
                return {"ok": self._ok}
        env = {"TELEGRAM_BOT_TOKEN": "TOKEN123", "TELEGRAM_CHAT_ID": "1"}
        auto.requests.post = lambda *a, **k: R(True)
        self.assertTrue(auto.telegram(env, "첫 줄 제목\n둘째 줄"))
        auto.requests.post = lambda *a, **k: R(False, 400)
        self.assertFalse(auto.telegram(env, "두 번째 알림"))
        self.assertEqual(self.logs, ["텔레그램 보냄 · 첫 줄 제목", "텔레그램 실패(HTTP 400) · 두 번째 알림"])

    def test_exception_does_not_leak_token(self):
        def boom(*a, **k):
            raise auto.requests.ConnectionError("HTTPSConnectionPool: /botTOKEN123/sendMessage")
        auto.requests.post = boom
        self.assertFalse(auto.telegram({"TELEGRAM_BOT_TOKEN": "TOKEN123", "TELEGRAM_CHAT_ID": "1"}, "알림"))
        self.assertTrue(self.logs and "TOKEN123" not in " ".join(self.logs), self.logs)
        self.assertIn("ConnectionError", self.logs[0])

    def test_alert_once_per_day(self):
        sent, st = [], {}
        self.assertTrue(auto.alert_once({}, st, "queue:X", "깨짐", notify=sent.append))
        self.assertFalse(auto.alert_once({}, st, "queue:X", "깨짐", notify=sent.append))
        self.assertEqual(sent, ["깨짐"])

    def test_rebuild_is_labelled(self):
        s = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pams_auto.py"), encoding="utf-8").read()
        self.assertIn('"🔁 원고 변경 — 키트 다시 만듦 · " if why == "원고 변경"', s)


class ScanZips(unittest.TestCase):
    def test_bad_handmade_zip_is_reported_once(self):
        import zipfile
        ev = "금융감독원, 최근 판례로 알아보는 실손보험 등 관련 소비자 유의사항, 2025, 2025.3.10.pdf"
        with tempfile.TemporaryDirectory() as d:
            with zipfile.ZipFile(os.path.join(d, "0930.zip"), "w") as z:
                z.writestr("a.pdf", "x"); z.writestr("b.pdf", "y"); z.writestr(ev, "z")
            with zipfile.ZipFile(os.path.join(d, "1001_10호_네이버.zip"), "w") as z:
                z.writestr("a.pdf", "x"); z.writestr(ev, "z")
            with zipfile.ZipFile(os.path.join(d, "1001_11호_스레드.zip"), "w") as z:
                z.writestr("notice.png", "x"); z.writestr("photo.png", "y")
            sent, st = [], {}
            self.assertEqual(auto.scan_zips(d, st, sent.append), ["0930.zip"])
            self.assertEqual(len(sent), 1)
            self.assertIn("2개", sent[0])
            self.assertEqual(auto.scan_zips(d, st, sent.append), [])   # 같은 zip 은 다시 안 알린다


if __name__ == "__main__":
    unittest.main(verbosity=2)
