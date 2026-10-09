#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""지식iN 파이프라인 시험 — 네트워크·DB·PAMS·텔레그램 없이 순수 함수와 흐름만.

    python scripts/test_kin_pipeline.py
"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kin_harvest as kh  # noqa: E402
import kin_pipeline as kp  # noqa: E402

KST = kh.KST
BODY = ("고지의무 질문을 주시는 분이 많습니다. " * 30).strip()  # 길이만 맞춘 가짜 본문(게이트는 TS 쪽 시험)


def item(doc, title="부담보 조건이 붙으면 어떻게 되나요?", ans=None, desc="조각"):
    link = f"https://kin.naver.com/qna/detail.naver?dirId=401030203&docId={doc}" + (f"&answerNo={ans}" if ans else "")
    return {"title": f"<b>{title}</b>", "link": link, "description": desc}


class Harvest(unittest.TestCase):
    def test_question_url_strips_answer(self):
        self.assertEqual(kh.question_url("https://kin.naver.com/qna/detail.naver?dirId=1&docId=9&answerNo=6"),
                         "https://kin.naver.com/qna/detail.naver?dirId=1&docId=9")
        self.assertIsNone(kh.question_url("https://kin.naver.com/x"))

    def test_group_and_answers_seen(self):
        g = kh.group_items({"부담보": [item(1, ans=2), item(1, ans=5, desc="다른"), item(2)], "고지의무": [item(2)]})
        self.assertEqual(g["1"]["answers_seen"], 5)
        self.assertEqual(g["1"]["snippets"], ["조각", "다른"])
        self.assertEqual(g["2"]["topics"], ["부담보", "고지의무"])
        self.assertEqual(g["1"]["title"], "부담보 조건이 붙으면 어떻게 되나요?")
        self.assertEqual(g["1"]["dirId"], "401030203")

    def test_exclusion(self):
        base = {"title": "고지의무 문의", "snippets": [], "answers_seen": 0, "dirId": "401030203"}
        self.assertIsNone(kh.exclusion(base, ["삼성화재"]))
        self.assertIn("보험 질문 아님", kh.exclusion({**base, "title": "전치3주 폭행 사건", "dirId": "602060203"}))
        # SH6 — 제목에 병명·약 상품명이 있으면 게이트(되받기)가 어차피 막는다 → 수집 단계에서 뺀다
        self.assertIn("제목 병명 — 되받기 불가피(마운자로)",
                      kh.exclusion({**base, "title": "마운자로 실비청구", "dirId": "7010106"}))
        self.assertIn("제목 병명", kh.exclusion({**base, "title": "제2형당뇨병 실비청구(동네병원)"}))
        self.assertIn("제목 병명", kh.exclusion({**base, "title": "갑상선암 진단 후 고지의무"}))
        self.assertIn("제목 병명", kh.exclusion({**base, "title": "통풍부담보관련 범위 질문드립니다", "dirId": "7010108"}))
        # SH6 실수집 — 「여유증수술」(병명 + 수술 붙여 씀) · 「암진단비」(게이트가 답변의 「암」을 막는다)
        self.assertEqual(kh.title_disease("여유증수술"), "여유증")
        self.assertEqual(kh.title_disease("암진단비를 줄이고 싶은데 어느 특약을 삭제"), "암")
        for title in ("질병 부담보 해제", "간병인보험 고지", "실비 영수증 청구 문의", "실손24 청구 궁금증",
                      "유병자보험 가입 고지", "상해 후유장애 청구", "간병인가입시 상해고지"):
            self.assertIsNone(kh.title_disease(title), title)
        # 2026-10-09 첫 실수집에서 섞여 들어온 것들
        for title, d in [("산재 민사소송시 과실비율이 궁금합니다", "6100403"),
                         ("부동산 약정서 등문의(매매, 부담보즈여)", "60202"),
                         ("간병인낙상사고로 인한 보상책임문의 합니다", "6020602"),
                         ("건강보험 지역가입자 미납으로 계좌 압류", "40106"),
                         ("자동차 사고 대인접수 후 택시비 실비 청구 거절당했는데", "81207"),
                         ("강아지 펫보험 질문해요", "80511"),
                         ("4대보험 상실 사유를 본인이 직접 확인할 수 있나요?", "6100401"),
                         ("배우자가 공동재산 연금보험을 독점할 때 이혼 분할이 가능", "60215"),
                         ("버팀목 전세대출 보험 관련 문의", "4020201")]:
            self.assertIsNotNone(kh.exclusion({**base, "title": title, "dirId": d}), title)
        for title, d in [("보험 부담보 해제 이후의 진료 보상 못받나요?", "60215"),
                         ("간병인가입시 상해고지", "1060101")]:
            self.assertIsNone(kh.exclusion({**base, "title": title, "dirId": d}), title)
        # SH5 — 법률 질문이 보험 분류로 들어와도 뺀다(조각의 「실비」 = 실제 비용)
        dementia = {**base, "title": "치매 어머니가 상속인인 경우 상속재산분할협의와 성년후견....",
                    "snippets": ["법원 송달료와 인지대, 감정비용 등 기본 실비가 수십만 원에서 100만 원 안팎으로 발생하며"]}
        for d in ("401030201", "60220"):
            self.assertIsNotNone(kh.exclusion({**dementia, "dirId": d}), d)
        self.assertIn("법률 질문(상속)", kh.exclusion({**dementia, "dirId": "401030201"}))
        self.assertIn("보험 신호어 없음", kh.exclusion({**base, "title": "이거 어떻게 하나요", "snippets": ["기본 실비만 들어요"]}))
        self.assertIsNone(kh.exclusion({**base, "title": "사망보험금 상속 문의"}))   # 제목에 보험 낱말이 있으면 남긴다
        # SH7 — 시효·청구 기한은 보험 신호어가 있어도, 제목이든 본문 조각이든 뺀다
        for title, snip in [("실비 청구 시효가 지났을까요", ""),
                            ("실손보험 청구기간 문의", ""),
                            ("보험금 청구 기한 있나요", ""),
                            ("실비 청구 가능할까요", "3년 전 입원인데 기한 지나서 못 받는다고"),
                            ("실비 청구 거절", "소멸시효 3년이라 안 된다고 하네요"),
                            ("실비 청구 가능할까요", "청구 기한을 넘겼는지 궁금합니다")]:
            q = {**base, "title": title, "snippets": [snip] if snip else []}
            self.assertEqual(kh.exclusion(q), "법률(시효·기한) — 사실 검증 불가", title + snip)
        for title in ("실비 청구 서류 문의", "고지의무 기간 5년 맞나요"):
            self.assertIsNone(kh.exclusion({**base, "title": title}), title)
        self.assertIn("답변 다수", kh.exclusion({**base, "answers_seen": 3}))
        self.assertIn("비교", kh.exclusion({**base, "title": "실비 어디가 좋나요 비교"}))
        self.assertIn("특정 회사", kh.exclusion({**base, "snippets": ["삼성화재 가입"]}, ["삼성화재"]))
        self.assertIn("개인정보", kh.exclusion({**base, "snippets": ["연락 010-1234-5678"]}))

    def test_ledger_baseline_then_fresh_then_stale(self):
        led, now = {}, datetime(2026, 10, 9, 9, tzinfo=KST)
        q1 = {"1": {"docId": "1", "title": "t", "snippets": [], "topics": ["부담보"], "answers_seen": 0, "url": "u1"}}
        out, base = kh.apply_ledger(q1, led, now)
        self.assertTrue(base)
        self.assertEqual(out, [])                       # 첫 실행 = 기준선, 후보 없음
        q2 = {**q1, "2": {**q1["1"], "docId": "2", "url": "u2"}}
        out, base = kh.apply_ledger(q2, led, now + timedelta(hours=1))
        self.assertFalse(base)
        self.assertEqual([q["docId"] for q in out], ["2"])   # 새로 보인 것만
        out, _ = kh.apply_ledger(q2, led, now + timedelta(hours=80))
        self.assertEqual(out, [])                       # 첫 관측 72시간 지나면 빠짐

    def test_no_baseline_first_run(self):
        q1 = {"1": {"docId": "1", "title": "t", "snippets": [], "topics": ["간병"], "answers_seen": 0, "url": "u1"}}
        out, base = kh.apply_ledger(q1, {}, datetime(2026, 10, 9, tzinfo=KST), baseline_if_empty=False)
        self.assertFalse(base)
        self.assertEqual(out[0]["age"], "미확인(첫 실행)")

    def test_collect_offline(self):
        with tempfile.TemporaryDirectory() as d:
            led = os.path.join(d, "seen.json")
            res = kh.collect({}, search_fn=lambda q: [item(abs(hash(q)) % 1000 + 1)], ledger_path=led,
                             baseline_if_empty=False)
            self.assertTrue(res["candidates"])
            self.assertTrue(all(c["closed"].startswith("미확인") for c in res["candidates"]))
            self.assertTrue(os.path.exists(led))


class Pick(unittest.TestCase):
    def cands(self, *topics):
        return [{"url": f"u{i}", "topic": t, "title": "q", "summary": "s"} for i, t in enumerate(topics)]

    def test_daily_cap_and_topic_once(self):
        st = {"kits": {}}
        got = kp.pick(self.cands("간병", "간병", "부담보", "고지의무", "실손청구", "간편심사", "리모델링점검"), st, "2026-10-09", 9)
        self.assertEqual(len(got), kp.DAILY_MAX)
        self.assertEqual(len({c["topic"] for c in got}), len(got))

    def test_room_left_today_and_prev_topic(self):
        st = {"kits": {"a": {"day": "2026-10-09", "topic": "간병", "question_url": "x", "created": "2"},
                       "b": {"day": "2026-10-08", "topic": "부담보", "question_url": "y", "created": "1"}}}
        got = kp.pick(self.cands("간병", "부담보", "고지의무"), st, "2026-10-09", 5)
        self.assertEqual([c["topic"] for c in got], ["고지의무"])   # 오늘 쓴 간병 · 어제 마지막 부담보 제외

    def test_done_url_skipped(self):
        st = {"kits": {"a": {"day": "2026-10-01", "topic": "간병", "question_url": "u0", "created": "1"}}}
        self.assertEqual(kp.pick(self.cands("고지의무"), st, "2026-10-09", 3), [])


class Notice(unittest.TestCase):
    PAMS = ("1. 본 내용은 모집종사자 개인의 의견이며, 계약체결에 따른 이익 또는 손실은 보험계약자 등에게 귀속됩니다.\n"
            "2. 필수안내사항\n신순주, 20030976050033 (손생보협회 등록번호)\n프라임에셋 심의필 제0000호 (2023.00.00~2024.00.00)")

    def test_fill_placeholder_only(self):
        out = kp.fill_notice(self.PAMS, "2026-10-1234", "2026-10-09", "2027-10-08")
        self.assertIn("제2026-10-1234호 (2026.10.09~2027.10.08)", out)
        self.assertEqual(out.replace("제2026-10-1234호 (2026.10.09~2027.10.08)", "제0000호 (2023.00.00~2024.00.00)"),
                         self.PAMS)

    def test_fill_already_filled(self):
        done = self.PAMS.replace("제0000호 (2023.00.00~2024.00.00)", "제2026-10-1234호 (2026.10.09~2027.10.08)")
        self.assertEqual(kp.fill_notice(done, "2026-10-1234", "2026-10-09", "2027-10-08"), done)

    def test_fill_stops(self):
        with self.assertRaises(kp.KinError):
            kp.fill_notice("필수안내 없음", "2026-10-1234", "2026-10-09", "2027-10-08")
        with self.assertRaises(kp.KinError):
            kp.fill_notice(self.PAMS, "프라임에셋 심의필 제2026-10-1234호", "2026-10-09", "2027-10-08")
        with self.assertRaises(kp.KinError):
            kp.fill_notice(self.PAMS + "\n" + self.PAMS, "2026-10-1234", "2026-10-09", "2027-10-08")

    def test_normalize(self):
        self.assertEqual(kp.normalize_review_no("프라임에셋 심의필 제2026-10-1234호"), "2026-10-1234")
        self.assertEqual(kp.normalize_review_no("2026-10-1234"), "2026-10-1234")
        self.assertIsNone(kp.normalize_review_no("2026-13-1234"))

    def rec(self, answer=BODY):
        import hashlib
        return {"answer": answer, "answer_sha256": hashlib.sha256(answer.encode()).hexdigest()}

    def test_final_appends_notice(self):
        out = kp.compose_final(self.rec(), self.PAMS, "2026-10-1234", "2026-10-09", "2027-10-08", "2026-10-09")
        self.assertTrue(out.startswith(BODY + "\n\n1. 본 내용은"))

    def test_final_uses_full_pams_view(self):
        full = BODY.replace(" ", "\n", 3) + "\n\n" + self.PAMS.replace("제0000호 (2023.00.00~2024.00.00)",
                                                                      "제2026-10-1234호 (2026.10.09~2027.10.08)")
        out = kp.compose_final(self.rec(), full, "2026-10-1234", "2026-10-09", "2027-10-08", "2026-10-09")
        self.assertEqual(out, full)   # 화면 원문이 곧 게시문(공백 차이 허용)

    def test_final_refuses_tampered_or_expired(self):
        r = self.rec()
        r["answer"] += "."
        with self.assertRaises(kp.KinError):
            kp.compose_final(r, self.PAMS, "2026-10-1234", "2026-10-09", "2027-10-08", "2026-10-09")
        with self.assertRaises(kp.KinError):
            kp.compose_final(self.rec(), self.PAMS, "2026-10-1234", "2026-10-09", "2027-10-08", "2027-10-09")
        changed = "다른 " + BODY + "\n\n" + self.PAMS
        with self.assertRaises(kp.KinError):   # PAMS 화면 답변이 우리 원고와 다르면 멈춤
            kp.compose_final(self.rec(), BODY[:60] + "바뀜" + BODY[60:] + "\n" + self.PAMS,
                             "2026-10-1234", "2026-10-09", "2027-10-08", "2026-10-09")
        self.assertTrue(changed)


class Flow(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.state = os.path.join(self.d, "state.json")
        self.kits = os.path.join(self.d, "kits")
        self.sent = []

    def harvest(self):
        return {"seen_total": 3, "baseline": False, "excluded": [],
                "candidates": [{"url": "https://kin.naver.com/qna/detail.naver?dirId=1&docId=11", "topic": "부담보",
                                "title": "부담보 질문", "summary": "요약"},
                               {"url": "https://kin.naver.com/qna/detail.naver?dirId=1&docId=12", "topic": "간병",
                                "title": "간병 질문", "summary": "요약"}]}

    def test_run_approve_posted_weekly(self):
        now = datetime(2026, 10, 9, 9, tzinfo=KST)
        make = lambda cs: [(c, BODY, "") if c["topic"] == "부담보" else (c, None, "게이트: premium: 3만원대") for c in cs]  # noqa: E731
        lines, made = kp.cmd_run({}, 3, False, harvest_fn=self.harvest, make_fn=make, notify=self.sent.append,
                                 state_path=self.state, kit_dir=self.kits, save_row=lambda e, r: ("kin-1", "ok"), now=now)
        self.assertEqual(len(made), 1)
        self.assertTrue(any("✖ [간병]" in l for l in lines))
        kid = made[0]["id"]
        self.assertEqual(kid, "1009_지식인_11")
        txt = open(os.path.join(self.kits, kid + ".txt"), encoding="utf-8").read()
        self.assertIn("게시위치: 네이버 지식인", txt)
        self.assertIn("카테고리: 그외 기타(건강,화재,펫 보험 등)", txt)
        self.assertIn("── PAMS 에 붙여 넣을 원고 ──\n" + BODY + "\n── 끝 ──", txt)
        self.assertIn("저장」 금지", txt)
        # 형식 계약(robert-os pams_apply 가 읽는다) — 1줄 머리 + 필드 블록(순서 고정, 값 뒤 설명 없음)
        lines = txt.split("\n")
        self.assertTrue(lines[0].startswith("[PAMS 접수 문자열] 지식인 · "))
        block = lines[1:1 + len(kp.KIT_FIELDS)]
        self.assertEqual([ln.split(": ", 1)[0] for ln in block], list(kp.KIT_FIELDS))
        self.assertEqual(lines[1 + len(kp.KIT_FIELDS)], "")
        for ln in block:
            self.assertNotIn("←", ln)
        fields = dict(ln.split(": ", 1) for ln in block)
        self.assertEqual(fields["카테고리"], "그외 기타(건강,화재,펫 보험 등)")
        self.assertTrue(fields["원고해시"].startswith("sha256 "))
        self.assertLessEqual(len(fields["특이사항"].encode("utf-8")), 100)
        self.assertEqual(len(self.sent), 1)
        self.assertIn("「제출」은 로버트", self.sent[0])

        # 엑셀변환(HTML 표) 승인 수거
        xls = os.path.join(self.d, "jidatexcel.xls")
        approved = BODY + "<br>" + Notice.PAMS.replace("\n", "<br>").replace(
            "제0000호 (2023.00.00~2024.00.00)", "제2026-10-1234호 (2026.10.09~2027.10.08)")
        open(xls, "w", encoding="utf-8").write(
            "<table><tr><th>No</th><th>신청일시</th><th>변경일시</th><th>심의필번호</th><th>심의필일자</th>"
            "<th>광고유효기간</th><th>답변내용</th></tr>"
            f"<tr><td>1</td><td>2026-10-09 10:00</td><td>2026-10-09 10:05</td><td>프라임에셋 심의필 제2026-10-1234호</td>"
            f"<td>2026-10-09</td><td>2027-10-08</td><td>{approved}</td></tr>"
            "<tr><td>2</td><td></td><td></td><td></td><td></td><td></td><td>심사중 건</td></tr></table>")
        recs = []
        out = kp.cmd_approvals({}, xls=xls, state_path=self.state, notify=self.sent.append,
                               record=lambda e, r, n, f, t: recs.append(n) or (None, "skip"), today="2026-10-09",
                               kit_dir=self.kits)
        self.assertEqual(out, [f"승인 처리 {kid} — 제2026-10-1234호"])
        self.assertEqual(recs, ["2026-10-1234"])
        final = open(os.path.join(self.kits, kid + "_게시본.txt"), encoding="utf-8").read()
        self.assertIn("제2026-10-1234호 (2026.10.09~2027.10.08)", final)
        self.assertNotIn("0000호", final)
        self.assertIn("그대로 복사해 지식iN", self.sent[-1])
        # 두 번 돌려도 다시 승인하지 않는다
        self.assertEqual(kp.cmd_approvals({}, xls=xls, state_path=self.state, notify=self.sent.append,
                                          record=lambda *a: (None, ""), today="2026-10-09", kit_dir=self.kits),
                         ["새 승인 없음"])

        with self.assertRaises(kp.KinError):
            kp.cmd_posted({}, kid, "https://blog.naver.com/x", state_path=self.state, setter=lambda e, r: [])
        kp.cmd_posted({}, kid, "https://kin.naver.com/qna/detail.naver?dirId=1&docId=11", state_path=self.state,
                      setter=lambda e, r: [])
        line = kp.weekly_line(kp.load_state(self.state), "2026-10-10", profile=12)
        self.assertEqual(line.count("\n"), 0)
        self.assertIn("질문 1 → 심의승인 1 → 답변 게시 1 → 프로필 조회 12", line)
        self.assertIn("카톡 미입력", line)

    def test_run_summary_has_expiry_line(self):
        """§6.3 — 일일 요약에 「심의필 만료 30일 이내 N건」 한 줄. 조회 실패는 숨기지 않고 수집도 막지 않는다."""
        make = lambda cs: []  # noqa: E731
        asked = []
        lines, _ = kp.cmd_run({}, 3, True, harvest_fn=self.harvest, make_fn=make, notify=self.sent.append,
                              state_path=self.state, kit_dir=self.kits, now=datetime(2026, 10, 9, 9, tzinfo=KST),
                              expiring_fn=lambda d: asked.append(d) or 2)
        self.assertEqual(asked, ["2026-10-09"])
        self.assertIn("지식iN 심의필 만료 30일 이내 2건 — PAMS 연장 신청 필요", lines)
        # SH6 관제탑 결정 — N>0 이면 텔레그램에도 한 줄(만든 키트가 없어도). 시험은 가짜 notify 로만(실발송 없음)
        self.assertEqual(self.sent, ["⏰ 지식iN 심의필 만료 30일 이내 2건 — PAMS 연장 신청 필요"])
        self.sent.clear()
        kp.cmd_run({}, 3, True, harvest_fn=self.harvest, make_fn=make, notify=self.sent.append,
                   state_path=self.state, kit_dir=self.kits, now=datetime(2026, 10, 9, 9, tzinfo=KST),
                   expiring_fn=lambda d: 0)
        self.assertEqual(self.sent, [])   # 0건이면 보내지 않는다
        kp.cmd_run({}, 3, True, harvest_fn=self.harvest, make_fn=make, notify=self.sent.append,
                   state_path=self.state, kit_dir=self.kits, now=datetime(2026, 10, 9, 9, tzinfo=KST),
                   expiring_fn=lambda d: 1 / 0)
        self.assertEqual(self.sent, [])   # 조회 실패도 텔레그램으로 겁주지 않는다(요약 줄에만 「조회 실패」)
        made = lambda cs: [(c, BODY, "") for c in cs[:1]]  # noqa: E731
        kp.cmd_run({}, 3, True, harvest_fn=self.harvest, make_fn=made, notify=self.sent.append,
                   state_path=self.state, kit_dir=self.kits, now=datetime(2026, 10, 9, 9, tzinfo=KST),
                   expiring_fn=lambda d: 3)
        self.assertEqual(len(self.sent), 1)   # 접수 대기 알림과 한 통으로
        self.assertTrue(self.sent[0].startswith("🙋 지식인 심의 접수 대기 1건"))
        self.assertTrue(self.sent[0].endswith("⏰ 지식iN 심의필 만료 30일 이내 3건 — PAMS 연장 신청 필요"))
        self.assertEqual(kp.expiry_line("2026-10-09", lambda d: 0), "지식iN 심의필 만료 30일 이내 0건")
        self.assertIn("조회 실패", kp.expiry_line("2026-10-09", lambda d: kp.count_expiring({}, d)))

    def test_count_expiring_queries_kin_only(self):
        seen = {}

        class R:
            status_code = 200

            def json(self):
                return [{"id": 1}, {"id": 2}]

        def fake_get(url, params, headers, timeout):
            seen.update(url=url, params=params)
            return R()
        env = {"NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"}
        orig, kp.requests.get = kp.requests.get, fake_get
        try:
            self.assertEqual(kp.count_expiring(env, "2026-10-09"), 2)
        finally:
            kp.requests.get = orig
        self.assertTrue(seen["url"].endswith("/rest/v1/ad_reviews"))
        self.assertIn(("channel", "eq.kin"), seen["params"])
        self.assertIn(("review_to", "lte.2026-11-08"), seen["params"])
        self.assertIn(("review_to", "gte.2026-10-09"), seen["params"])

    def test_dry_run_writes_nothing(self):
        make = lambda cs: [(c, BODY, "") for c in cs]  # noqa: E731
        kp.cmd_run({}, 3, True, harvest_fn=self.harvest, make_fn=make, notify=self.sent.append,
                   state_path=self.state, kit_dir=self.kits, save_row=lambda *a: self.fail("DB 쓰면 안 됨"))
        self.assertFalse(os.path.exists(self.state))
        self.assertFalse(os.path.exists(self.kits))

    def test_make_answers_retries_once_with_feedback(self):
        calls = []

        def draft_fn(reqs):
            calls.append(reqs)
            return [{"id": r["id"], "text": "좋은 본문" if r.get("feedback") else "나쁜 본문"} for r in reqs]

        def gate_fn(items):
            return [{"pass": it["answer"] == "좋은 본문", "findings": [] if it["answer"] == "좋은 본문"
                     else [{"rule": "premium", "term": "3만원대"}]} for it in items]

        res = kp.make_answers([{"url": "u", "title": "t", "summary": "s"}], draft_fn, gate_fn, lambda xs: [""] * len(xs))
        self.assertEqual(res[0][1], "좋은 본문")
        self.assertIn("premium: 3만원대", calls[1][0]["feedback"])

    def test_style_catalog_and_plan(self):
        """SH6 — 여닫는 방식 각 8가지 이상, 한 실행 안에서 서로 다른 번호."""
        self.assertGreaterEqual(len(kp._ts_array("KIN_OPENINGS")), 8)
        self.assertGreaterEqual(len(kp._ts_array("KIN_CLOSINGS")), 8)
        self.assertIn("제 의견으로는", kp.fixed_phrases())
        import random
        plan = kp.style_plan(5, random.Random(1))
        for k in ("open", "close", "opinion"):
            self.assertEqual(len({p[k] for p in plan}), 5, k)

    def test_variety_findings(self):
        today = "2026-10-09"
        old = ("제 의견으로는 이 질문은 고지 문항부터 보셔야 합니다. 둘째 문장입니다. "
               "결국 계약 전체를 담보 단위로 펼쳐 대조해 봐야 정확해집니다.")
        hist = [{"text": old, "day": "2026-10-08"}]
        same_open = ("제 의견으로는 이 질문은 고지 문항부터 보셔야 합니다! 다른 문장입니다. "
                     "약관 문구에 따라 결론이 달라질 수 있습니다.")
        f = kp.variety_findings(same_open, hist, today, [])
        self.assertTrue(any("첫 문장" in x["term"] for x in f), f)
        self.assertFalse(any("마지막 문장" in x["term"] for x in f))
        fresh = "판단을 가르는 기준은 청약서 문항의 기간입니다. 가운데 문장입니다. 다음엔 약관의 정의 조항을 보시면 됩니다."
        self.assertEqual(kp.variety_findings(fresh, hist, today, ["제 의견으로는"]), [])
        # 고정 어구 하루 1회 — 오늘 이미 쓴 어구면 막고, 어제 쓴 것은 괜찮다
        phrase = "가운데에 제 의견으로는 이렇습니다."
        self.assertEqual(kp.variety_findings(fresh.replace("가운데 문장입니다.", phrase), hist, today, ["제 의견으로는"]), [])
        hist_today = [{"text": old, "day": today}]
        f = kp.variety_findings(fresh.replace("가운데 문장입니다.", phrase), hist_today, today, ["제 의견으로는"])
        self.assertEqual([x["term"] for x in f], ["고정 어구 하루 2회: 제 의견으로는"])
        # 최근 10건까지만 본다
        many = [{"text": "다른 글입니다. 끝입니다.", "day": "2026-10-01"}] * 10 + hist
        self.assertEqual(kp.variety_findings(same_open, many, today, []), [])

    def test_make_answers_rewrites_on_repeat_with_new_style(self):
        """같은 실행 안에서 앞 답변과 첫 문장이 겹치면 다른 틀로 다시 쓴다."""
        calls = []
        a1 = "판단을 가르는 기준은 문항의 기간입니다. 가운데입니다. 약관 문구에서 갈립니다."
        a2 = "먼저 볼 것은 가입 시점입니다. 가운데입니다. 다음 순서는 청약서 사본입니다."

        def draft_fn(reqs):
            calls.append(reqs)
            return [{"id": r["id"], "text": a2 if r.get("feedback") else a1} for r in reqs]

        def gate_fn(items):
            return [{"pass": True, "findings": []} for _ in items]
        styles = [{"open": i, "close": i, "opinion": i} for i in range(6)]
        cands = [{"url": "u1", "title": "t", "summary": "s"}, {"url": "u2", "title": "t", "summary": "s"}]
        log = []
        res = kp.make_answers(cands, draft_fn, gate_fn, lambda xs: [""] * len(xs), history=[], today="2026-10-09",
                              phrases=[], styles=styles, on_round=lambda *a: log.append(a))
        self.assertEqual([r[1] for r in res], [a1, a2])
        self.assertEqual([r["style"]["open"] for r in calls[0]], [0, 1])
        self.assertEqual(calls[1][0]["id"], "u2")
        self.assertEqual(calls[1][0]["style"]["open"], 2)          # 겹친 뒤엔 아직 안 쓴 틀
        self.assertIn("repeat: 첫 문장", calls[1][0]["feedback"])
        self.assertEqual([(r[0], r[1]) for r in log], [(1, "u1"), (1, "u2"), (2, "u2")])

    def test_special_note_fits(self):
        for t in kh.TOPICS:
            self.assertLessEqual(len(kp.special_note(t).encode("utf-8")), kp.NOTE_MAX_BYTES)


if __name__ == "__main__":
    unittest.main(verbosity=1)
