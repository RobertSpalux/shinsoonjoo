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

    # KQ1 회귀 — 2026-10-14~16 키트로 만든 실제 질문(kin_state.json 의 제목·요약·dirId 그대로).
    # 495567566 은 「고지의무」 낱말 하나로 부동산(60103) 질문이 통과해 심의까지 받았다.
    KQ1_OFF = ("60103", "부동산 중개인 고지의무위반",
               "일단 방향만 말씀드리면, 공인중개사는 거래에 중요한 영향을 미치는 사항을 사전에 알려야 할 고지의무가 있어요. "
               "집 앞 도로가 국유지고 이용료가 발생한다는 건 매수 결정에 분명히 영향을 주는 중요한 정보라서, 이걸 알고도 안...")
    KQ1_ON = [
        ("401030201", "보험 최종납입월 및 납입횟수 관련", "1세대 실비이고 최종납입월이 24년06월이고 납입횟수 180회(총 180회)라고 되어 있습니다."),
        ("709", "실비 가입 후 언제쯤 병원에 가도 괜찮을까요?",
         "하지만 보험사의 '계약 전 알릴 의무(고지의무)'와 '실비 보상 약관'의 냉혹한 구조를 모르고 가입 직후 병원에..."),
        ("401030201", "오토바이 과실100 자기신체사고",
         "또한 운전자보험이나 개인 실손·상해후유장해 보험이 있다면 가입 조건(이륜차 부담보 여부 등)에 따라"),
        ("60803", "국밈보험공단 기타 징수금", "② 건강보험공단 관할 지사에 '이의신청서' 공식 제출: - 환수 고지서를 보낸 공단 담당자에게"),
        ("4010302", "양압기 구매", "건강체보험의 경우에는 최근 5년 이내의 입원력을 묻기 때문에 고지를 해야만 하고"),
        ("70112", "노안 늦추는 안약이나 레이저 치료받으면 실비 청구 가능한....",
         "노안 늦추는 안약이나 레이저 치료받으면 제가 개인적으로 든 실손 의료비(실비) 보험으로 청구 가능한가요?"),
        ("4010302", "보험금 청구를 포기하고 싶다고 했는데 보류 처리됐습니다. ....",
         "오토바이 부담보 특약 부가 등 계약 변경을 점검해 두셔야 합니다."),
        ("4010302", "티빙 보상 중 피싱 안전보험은 따로 가입해야 하나요?", "현재 가입한 보험의 보장 내용 분석"),
    ]

    def test_kq1_insurance_scope(self):
        dicts = kh.disease_dict()    # 실수집과 같은 병명 사전
        d, title, snip = self.KQ1_OFF
        q = {"title": title, "snippets": [snip], "answers_seen": 0, "dirId": d}
        self.assertIsNotNone(kh.exclusion(q, dicts=dicts))
        self.assertIsNotNone(kh.scope_exclusion(title, title + " " + snip, d))
        # 「고지의무」 단독으로는 분류가 어디든 통과하지 않는다 — 차단 분류는 낱말을 보태도 막는다
        self.assertIsNotNone(kh.scope_exclusion("고지의무 위반 문의", "고지의무 위반", "709"))
        self.assertIsNotNone(kh.scope_exclusion(title, title + " 중개사 보증보험 청구 절차", d))
        for d, title, snip in self.KQ1_ON:
            q = {"title": title, "snippets": [snip], "answers_seen": 0, "dirId": d}
            self.assertIsNone(kh.exclusion(q, dicts=dicts), title)
        # kin_pipeline 의 키트 직전 재확인 — 같은 판정
        url = "https://kin.naver.com/qna/detail.naver?dirId={}&docId={}"
        cands = [{"url": url.format(d, i), "title": t, "summary": s, "topic": "고지의무"}
                 for i, (d, t, s) in enumerate([self.KQ1_OFF] + self.KQ1_ON)]
        keep, off = kp.in_scope(cands)
        self.assertEqual([c["title"] for c, _ in off], ["부동산 중개인 고지의무위반"])
        self.assertEqual(len(keep), 8)

    # KQ2 — kin_answers.question_body 에 들어간 남의 답변 조각(관제탑 10/19 대조, inbox 원문)
    KQ2_ANSWER_SNIPS = [
        "[ 핵심 결론 ] 질문자님의 2년 6개월 전 검진 결과는",
        "손해사정서 작성까지 도와드릴 수 있으니 상담 문의해 주시기 바랍니다",
        "[ 핵심 결론 ] 실손보험 가입이 거절되었더라도",
        "오토바이 부담보 특약 부가 등 계약 변경을 점검해 두셔야 합니다.",
    ]
    KQ2_QUESTION_SNIPS = [
        "노안 늦추는 안약이나 레이저 치료받으면 제가 개인적으로 든 실손 의료비(실비) 보험으로 청구 가능한가요?",
        "1세대 실비이고 최종납입월이 24년06월이고 납입횟수 180회(총 180회)라고 되어 있습니다.",
        "치아보험 가입하려는데 2년 반 전에 받은 검진도 알려야 하나요?",
    ]

    def test_kq2_question_body_only(self):
        q_link = "https://kin.naver.com/qna/detail.naver?dirId=4010302&docId=495435597"
        for s in self.KQ2_ANSWER_SNIPS:
            self.assertFalse(kh.question_snippet(q_link, s), s)           # 답변 표지 → 질문 본문 아님
        for s in self.KQ2_QUESTION_SNIPS:
            self.assertTrue(kh.question_snippet(q_link, s), s)
            self.assertFalse(kh.question_snippet(q_link + "&answerNo=1", s), s)   # answerNo 결과 = 답변 조각
        g = kh.group_items({"고지의무": [item(7, ans=1, desc=self.KQ2_QUESTION_SNIPS[2]),
                                       item(7, desc=self.KQ2_ANSWER_SNIPS[0]),
                                       item(8, desc=self.KQ2_QUESTION_SNIPS[2])]})
        self.assertEqual(g["7"]["body"], [])                    # 질문 조각이 하나도 없다
        self.assertEqual(len(g["7"]["snippets"]), 2)            # 제외 판정용 전체 조각은 남긴다
        self.assertEqual(g["8"]["body"], [self.KQ2_QUESTION_SNIPS[2]])
        self.assertEqual(kh.summarize(g["7"]), "")
        self.assertNotIn("핵심 결론", kh.summarize({**g["7"], "body": g["8"]["body"]}))
        base = {"title": "치아보험 고지 문의", "answers_seen": 0, "dirId": "4010302"}
        self.assertEqual(kh.exclusion({**base, **{k: g["7"][k] for k in ("snippets", "body")}}),
                         "질문 본문 없음(검색 조각이 답변뿐)")
        self.assertIsNone(kh.exclusion({**base, **{k: g["8"][k] for k in ("snippets", "body")}}))
        # collect 행의 summary(→ kin_answers.question_body)에 답변 조각이 들어가지 않는다
        with tempfile.TemporaryDirectory() as d:
            res = kh.collect({}, search_fn=lambda q: [item(7, title="치아보험 고지 문의", ans=1, desc=self.KQ2_ANSWER_SNIPS[0]),
                                                     item(8, title="치아보험 고지 문의", desc=self.KQ2_QUESTION_SNIPS[2])],
                             ledger_path=os.path.join(d, "seen.json"), baseline_if_empty=False)
            self.assertEqual([c["docId"] for c in res["candidates"]], ["8"])
            self.assertEqual(res["candidates"][0]["summary"], self.KQ2_QUESTION_SNIPS[2])
            self.assertIn("질문 본문 없음", next(x["excluded"] for x in res["excluded"] if x["docId"] == "7"))

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

    def harvest(self):   # 둘 다 의도 명확(KQ4) — 묻는 것·상품·상황이 제목+조각에 있다
        return {"seen_total": 3, "baseline": False, "excluded": [],
                "candidates": [{"url": "https://kin.naver.com/qna/detail.naver?dirId=1&docId=11", "topic": "부담보",
                                "title": "부담보 기간 끝나면 보장되나요?", "summary": "가입할 때 부담보 조건이 붙었습니다"},
                               {"url": "https://kin.naver.com/qna/detail.naver?dirId=1&docId=12", "topic": "간병",
                                "title": "간병보험 가입하려는데 고지해야 하나요?", "summary": "작년에 입원한 적이 있습니다"}]}

    def test_run_approve_posted_weekly(self):
        now = datetime(2026, 10, 9, 9, tzinfo=KST)
        make = lambda cs: [(c, BODY, "") if c["topic"] == "부담보" else (c, None, "게이트: premium: 3만원대") for c in cs]  # noqa: E731
        lines, made = kp.cmd_run({}, 3, False, harvest_fn=self.harvest, make_fn=make, notify=self.sent.append,
                                 state_path=self.state, kit_dir=self.kits, save_row=lambda e, r: ("kin-1", "ok"), now=now)
        self.assertEqual(len(made), 1)
        self.assertTrue(any("✖ [간병]" in l for l in lines))
        kid = made[0]["id"]
        self.assertEqual(kid, "1009_지식인_11")
        with open(os.path.join(self.kits, kid + ".txt"), encoding="utf-8") as f:
            txt = f.read()
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
        with open(xls, "w", encoding="utf-8") as f:
            f.write(
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
        with open(os.path.join(self.kits, kid + "_게시본.txt"), encoding="utf-8") as f:
            final = f.read()
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
            return [{"id": r["id"], "text": "좋은 본문" if r.get("feedback") else "나쁜 본문", "core": "본문 기준", "direct": True}
                    for r in reqs]

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
        a1 = "통상 문항의 기간이 기준입니다. 가운데입니다. 약관 문구에서 갈립니다."
        a2 = "보통 가입 시점을 먼저 봅니다. 가운데입니다. 다음 순서는 청약서 사본입니다."

        def draft_fn(reqs):
            calls.append(reqs)
            return [{"id": r["id"], "text": a2 if r.get("feedback") else a1, "core": "문항 시점", "direct": True}
                    for r in reqs]

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

    # KQ2 회귀 — 2026-10-19 승인 8건의 첫 두 문장(승인본 그대로, 고치지 않는다) · 질문 핵심은 승인본·관제탑 대조로 추정.
    # 관제탑 판정: 4518·4520·4532 사실상 무응답. 기계 판정(낱말·미루는 서두)만 본다 — 자체 채점은 승인본에 없다.
    KQ2_APPROVED = [
        ("4518", "몇 년 전 구강 검진 이력이 치아보험 가입 때 고지 대상인가",
         "이 사안의 판단을 가르는 기준은 청약서의 고지 문항이 어느 기간까지, 어떤 내용을 묻고 있는지입니다. "
         "계약 전 알릴 의무는 보험회사가 질문한 범위 안에서 사실대로 답하는 의무입니다.", False),
        ("4520", "부담보 조건이 있는 계약에서 그 뒤 확정된 진단이 보장되는가",
         "가장 먼저 보실 것은 증권에 적힌 부담보 조건의 범위입니다. "
         "그다음은 가입 당시 고지 문항의 문구이고, 마지막은 진단이 확정된 시점과 그 진단의 분류입니다.", False),
        ("4532", "가입 뒤 생긴 이동수단 사고가 계약 후 알릴 의무 위반이 되는가",
         "지금 상황을 시점으로 나눠 보면 이렇습니다. "
         "가입은 이미 끝났고, 사고 뒤 처음 낸 청구는 처리되었으며, 그 뒤에 추가로 낸 청구에서 거절 통보를 받으신 단계입니다.", False),
        ("4542", "치료 기간 생계비를 배상책임보험에서 받을 수 있는가",
         "휴업손해는 다친 뒤 일을 하지 못한 기간 동안 벌지 못한 소득을 손해로 보고 계산하는 항목입니다. "
         "배상책임보험에서는 생계비가 대개 이 항목으로 다뤄집니다.", True),
        ("4550", "검사 중 발견된 다른 질환이 보장되는가",
         "검사 중에 다른 질환이 확인되었을 때 보장 여부를 가르는 첫 기준은 그 질환이 언제 시작된 것으로 보느냐, "
         "즉 보험 가입 시점과 발병 시점 중 어느 쪽이 먼저냐입니다. 검사에서 우연히 발견되었다는 사실보다, "
         "가입 전에 이미 관련 증상이나 진료 이력이 있었는지가 더 무겁게 다뤄지는 경우가 많습니다.", True),
        ("4554", "사망 서류를 발급받는 사람이 보험금도 받을 수 있는가",
         "이 질문에서 많이 헷갈리시는 지점은 사망을 증명하는 서류를 누가 발급받느냐와 보험금을 누가 받느냐를 같은 문제로 보시는 부분입니다. "
         "두 가지는 따로 움직이는 경우가 많습니다.", True),
        ("4555", "여러 계약에 겹친 보장이 중복 지급되는가",
         "보험은 계약마다 따로 가입하고 따로 관리하는 구조라서, 이름이 다른 계약을 여러 개 들다 보면 같은 성격의 보장이 여러 곳에 겹쳐 담기는 일이 자연스럽게 생깁니다. "
         "증권에는 그 계약 하나만 보이고 다른 계약과 무엇이 겹치는지는 표시되지 않습니다.", True),
        ("4548", "실손 가입이 거절된 뒤 다른 보장성 계약을 어떻게 가입하나",
         "지금은 실손 가입 심사에서 거절 결과를 받았고, 다른 보장성 계약은 아직 가입 전인 시점으로 보입니다. "
         "이 시점에서는 무엇을 먼저 가입할지보다 거절이 어떤 사유로 나왔는지를 먼저 정리해 두셔야 합니다.", True),
    ]

    def test_kq2_intent_regression(self):
        for no, core, lead, ok in self.KQ2_APPROVED:
            f = kp.intent_findings(core, True, lead + "\n\n둘째 문단입니다.")
            self.assertEqual(not f, ok, f"{no} {f}")

    def test_intent_findings(self):
        good = ("치아보험 청약서는 보통 최근 일정 기간 안의 치료·검사 소견을 묻습니다. 상품마다 묻는 기간이 다르니 본인 청약서 문항이 기준입니다."
                "\n\n판단 요소는 이렇습니다.")
        self.assertEqual(kp.intent_findings("검진 이력이 치아보험 고지 대상인가", True, good), [])
        self.assertEqual([x["term"] for x in kp.intent_findings("", True, good)], ["질문 핵심 없음"])
        self.assertIn("자체 채점 「아니오」", [x["term"] for x in kp.intent_findings("치아보험 고지", False, good)])
        self.assertTrue(any("핵심 낱말 없음" in x["term"] for x in kp.intent_findings("수익자 변경 절차", True, good)))

    def test_make_answers_drops_after_intent_retry(self):
        """질의 적합 불합격 → 사유를 붙여 1회 다시 → 또 불합격이면 후보에서 뺀다(3회차 없음)."""
        calls = []
        lead = "이 사안의 판단을 가르는 기준은 문항의 기간입니다. 둘째 문장입니다."

        def draft_fn(reqs):
            calls.append(reqs)
            return [{"id": r["id"], "text": lead, "core": "문항 기간이 고지 대상인가", "direct": True} for r in reqs]
        res = kp.make_answers([{"url": "u", "title": "t", "summary": "s"}], draft_fn,
                              lambda xs: [{"pass": True, "findings": []} for _ in xs], lambda xs: [""] * len(xs),
                              history=[], phrases=[], styles=[{"open": 0, "close": 0, "opinion": 0}] * 3)
        self.assertIsNone(res[0][1])
        self.assertIn("질의 적합 불합격", res[0][2])
        self.assertEqual(len(calls), 2)
        self.assertIn("intent: 답을 미루는 서두", calls[1][0]["feedback"])

    # ── KQ4 — 질문 의도는 검색 API 제목 + 질문 조각으로만 · 채택 기준 게이트 ─────────────────
    KQ4_TITLE = "치아보험 고지의무사항 위반?"
    KQ4_SNIP = "치아보험 가입 2년 전에 치과 검진에서 치료 권유를 받았는데 치료는 안 받았습니다"
    KQ4_GOOD = ("치아보험 청약서는 통상 최근 일정 기간 안에 치료를 받았거나 치료가 필요하다는 소견을 들은 적이 있는지를 묻습니다. "
                "가입 전 일이라도 문항이 묻는 기간 안에 들어가면, 실제 치료를 받지 않았더라도 그 소견은 알리는 쪽으로 보는 경우가 많습니다."
                "\n\n제 의견으로는 검진 기록의 날짜가 가장 중요합니다."
                "\n\n가입한 보험사에 청약서 사본을 요청하고, 그때 다닌 치과에 진료 기록 사본을 요청해 날짜를 확인해 두시면 됩니다.")
    KQ4_ABSTRACT = ("이 사안의 판단을 가르는 기준은 문항이 어느 기간까지, 어떤 내용을 묻고 있는지입니다. "
                    "알릴 의무는 보험회사가 질문한 범위 안에서 사실대로 답하는 의무입니다."
                    "\n\n결국 약관 문구에 따라 결론이 달라질 수 있습니다.")

    def test_kq4_question_intent(self):
        i, why = kp.question_intent(self.KQ4_TITLE, self.KQ4_SNIP)
        self.assertEqual(why, "")
        self.assertEqual(i["ask"], self.KQ4_TITLE)                  # 묻는 것 — 제목 우선
        self.assertIn("치아보험", i["products"])
        self.assertIn("가입 시점", i["situations"])
        self.assertIn("고지", i["situations"])
        # 묻는 것이 조각에만 있어도 잡는다(조각은 「 / 」로 이어져 온다 — kin_harvest.summarize)
        i, _ = kp.question_intent("배상책임보험중 생계비", "치료 중이라 일을 못 하고 있습니다 / 생계비도 받을 수 있나요")
        self.assertEqual(i["ask"], "생계비도 받을 수 있나요")
        self.assertIn("소득·생계", i["situations"])
        # 「~랍니다」로 끝나는 제목(들은 결과를 옮김)도 묻는 것으로 친다
        i, _ = kp.question_intent("전동퀵보드사고 실비보험 보험금지급불가랍니다", "")
        self.assertTrue(i and "거절·부지급" in i["situations"] and "사고" in i["situations"])

    def test_kq4_question_intent_rejects(self):
        """셋 중 하나라도 못 잡으면 후보에서 뺀다 — 사유에 무엇을 못 잡았는지 남긴다."""
        self.assertEqual(kp.question_intent("보험 질문", "")[1], "의도 불명확(묻는 것·상품·담보 종류·질문자 상황 못 잡음)")
        _, why = kp.question_intent("보험 가입할 때 뭘 봐야 하나요?", "")     # 「보험」 단독은 상품 종류가 아니다
        self.assertIn("상품·담보 종류", why)
        _, why = kp.question_intent("치아보험 좋은가요?", "")               # 질문자 상황 사실이 없다
        self.assertIn("질문자 상황", why)
        _, why = kp.question_intent("실비 청구 서류", "작년에 입원했습니다")  # 묻는 문장이 없다
        self.assertIn("묻는 것", why)
        keep, drop = kp.split_by_intent([{"title": self.KQ4_TITLE, "summary": self.KQ4_SNIP},
                                         {"title": "보험 질문", "summary": ""}])
        self.assertEqual(len(keep), 1)
        self.assertIn("intent", keep[0])
        self.assertEqual(len(drop), 1)

    def test_kq4_run_skips_unclear(self):
        """의도 불명확 후보는 초안을 만들지 않고 사유 줄만 남긴다. 사람에게 원문을 달라는 알림은 없다(KQ4)."""
        d = tempfile.mkdtemp()
        sent = []

        def harvest():
            return {"seen_total": 2, "baseline": False, "excluded": [],
                    "candidates": [{"url": "https://kin.naver.com/qna/detail.naver?dirId=4010302&docId=21", "topic": "부담보",
                                    "title": "부담보 질문", "summary": "요약"}]}
        lines, made = kp.cmd_run({}, 3, True, harvest_fn=harvest, make_fn=lambda cs: self.fail("의도 불명확은 초안 금지"),
                                 notify=sent.append, state_path=os.path.join(d, "s.json"), kit_dir=os.path.join(d, "k"),
                                 now=datetime(2026, 10, 19, 9, tzinfo=KST), expiring_fn=lambda x: 0)
        self.assertEqual(made, [])
        self.assertIn("의도 불명확 1", lines[0])
        self.assertTrue(any(l.startswith("🔍 [부담보] 부담보 질문 — 의도 불명확(") for l in lines), lines)
        self.assertEqual(sent, [])
        self.assertFalse(hasattr(kp, "QUESTION_DIR"))   # 사람이 원문을 옮기는 경로는 없다

    def test_kq4_adoption_findings(self):
        i, _ = kp.question_intent(self.KQ4_TITLE, self.KQ4_SNIP)
        self.assertEqual(kp.adoption_findings(i, self.KQ4_GOOD), [])
        terms = [f["term"] for f in kp.adoption_findings(i, self.KQ4_ABSTRACT)]
        self.assertTrue(any(t.startswith("질문자 상황 반영") and "✗" in t for t in terms), terms)   # 「치아보험」을 안 다룸
        self.assertIn("마지막 문단에 다음 할 일 없음", terms)
        # 상품은 다뤘지만 상황을 하나도 안 다루면 불합격
        only_product = "치아보험은 상품마다 다릅니다. 통상 그렇습니다.\n\n보험사에 약관 사본을 요청해 두시면 됩니다."
        self.assertTrue(any(f["term"].startswith("질문자 상황 반영 1/2") for f in kp.adoption_findings(i, only_product)))
        # 「실비」로 물었으면 답의 「실손」도 받은 것으로 친다
        j, _ = kp.question_intent("실비 청구 거절됐는데 어떻게 하나요?", "")
        body = "실손은 통상 거절 사유가 서면으로 옵니다. 보통 그렇습니다.\n\n보험사에 거절 사유를 서면으로 요청해 두시면 됩니다."
        self.assertEqual(kp.adoption_findings(j, body), [])

    def test_kq4_make_answers_drops_abstract(self):
        """의도 후보 — 상황을 안 다루고 할 일 없이 끝나면 1회 재생성, 또 그러면 후보 제외. 초안기에 의도가 간다."""
        calls = []

        def draft_fn(reqs):
            calls.append(reqs)
            return [{"id": r["id"], "text": self.KQ4_ABSTRACT, "core": "문항이 묻는 기간이 고지 대상인가", "direct": True}
                    for r in reqs]
        i, _ = kp.question_intent(self.KQ4_TITLE, self.KQ4_SNIP)
        c = {"url": "u", "title": self.KQ4_TITLE, "summary": self.KQ4_SNIP, "intent": i}
        res = kp.make_answers([c], draft_fn, lambda xs: [{"pass": True, "findings": []} for _ in xs],
                              lambda xs: [""] * len(xs), history=[], phrases=[], styles=[{"open": 0, "close": 0, "opinion": 0}] * 3)
        self.assertIsNone(res[0][1])
        self.assertIn("질의 적합 불합격", res[0][2])
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0]["intent"]["products"], ["치아보험"])
        self.assertIn("adopt: 마지막 문단에 다음 할 일 없음", calls[1][0]["feedback"])
        # 좋은 답은 한 번에 통과
        good = lambda reqs: [{"id": r["id"], "text": self.KQ4_GOOD, "core": "치아보험 고지 대상인가", "direct": True}  # noqa: E731
                             for r in reqs]
        res = kp.make_answers([c], good, lambda xs: [{"pass": True, "findings": []} for _ in xs],
                              lambda xs: [""] * len(xs), history=[], phrases=[], styles=[{"open": 0, "close": 0, "opinion": 0}] * 3)
        self.assertEqual(res[0][1], self.KQ4_GOOD)

    # KQ4 실측(2026-10-19 검색 API) — 승인 8건 모든 결과에 answerNo 가 붙어 있었다. description = 질문 일부 + 그 답변 일부.
    KQ4_DESCS = {   # 495581358(4532) 실제 조각 축약 — 질문 글은 답변마다 되풀이되고, 답변 글은 한 번씩만 나온다
        "1": ["가지않아 전동퀵보드 사고지만 보험금지급이 된 사례도 제출을하였습니다... 그리고는 보험금 지급불가 라고 하는상황이구요"
              " 이과정에서 76만원에 대한건... 가입한 보험이 실비보험(치료비를 보상받는 보험)인지 상해보험인지"],
        "3": ["가지않아 전동퀵보드 사고지만 보험금지급이 된 사례도 제출을하였습니다 그렇지만 여전히 보험금지급이 어렵다..."
              " 현재 상황에서 보험금 지급이 무조건 불가능하다고 단정할 사안은 아닙니다."],
        "4": ["사고로 슬개골골절이 발생하여 수술을하고 치료를 받고있습니다 보험사는... 그리고는 보험금 지급불가 라고 하는상황이구요"],
    }

    def test_kq4_shared_spans_are_question_text(self):
        spans = kh.shared_spans(self.KQ4_DESCS)
        joined = " / ".join(spans)
        self.assertIn("전동퀵보드 사고지만 보험금지급이 된 사례도 제출을하였습니다", joined)
        self.assertIn("보험금 지급불가 라고 하는상황이구요", joined)
        for answer_only in ("실비보험(치료비를", "무조건 불가능하다고", "슬개골골절"):   # 한 답변에만 있는 글은 안 들어온다
            self.assertNotIn(answer_only, joined)
        # group_items — answerNo 결과뿐이어도 답변끼리 겹친 글이 질문 본문이 된다. 답변 하나뿐이면 질문 본문 없음(종전대로)
        items = [item(9, ans=a, desc=d) for a, ds in self.KQ4_DESCS.items() for d in ds]
        self.assertTrue(kh.group_items({"실손청구": items})["9"]["body"])
        self.assertEqual(kh.group_items({"실손청구": items[:1]})["9"]["body"], [])
        # answerNo=0 조각은 질문 글(495435597 실측)
        self.assertTrue(kh.question_snippet(item(1, ans=None)["link"] + "&answerNo=0", "치아보험 고지 의무 해당사항인가요?"))

    # 같은 날 API 로 다시 받은 승인 8건 — 제목 + 질문 본문(KQ2 필터 + 겹친 글). 의도가 잡히는 4건만 후보가 된다.
    KQ4_APPROVED = [
        ("4518", "치아보험 고지의무사항 위반?",
         "보통 치아보험 무진단형으로 가입하면 최근1년충치치료 최근5년 잇몸수술 틀니착용하냐 고지의무사항있던데 2년6개월이 넘었는데 "
         "저도 고지 의무 해당사항인가요? 틀니도없고 기간도 해당안되는거 같은데.. 그리고 치아보험...", True),
        ("4520", "2017년 5월 2일 보험가입 후 2018년 양성종양",
         "2017년 5월 2일 보험가입 후 2018년 양성종양 수술 2026년 9월 암진단 진단비 받을 수 있을까요? 특정부위,질병 부담보 특약에 "
         "가입되어 있어요. 면책기간 보험전기간으로.", True),
        ("4532", "전동퀵보드사고 실비보험 보험금지급불가랍니다",
         "가지않아 전동퀵보드 사고지만 보험금지급이 된 사례도 제출을하였습니다 / 그리고는 보험금 지급불가 라고 하는상황이구요", True),
        ("4542", "배상책임보험중 생계비", "", False),            # 답변 하나 + 우리 답변 — 겹친 글 없음
        ("4550", "엑스레이검사시 다른질병 확인되면",
         "그러면 내과소견이지만 정형외과 선생님이 판단을 내릴수있나요 그야물론 질병확인은 좋은검사이지만 보험도 영향이 있을것 같아서요", False),
        ("4554", "사망진단서 발급과 보험금", "", False),
        ("4555", "교보라플 질문", "1. 건강 보험. 2.입원비보험 2 수술비보험. 3가지. 중복으로 들어 가게되잖아요 중복 가입 과. 중복지급이 되는건가요", True),
        ("4548", "가입 거절 당한 실손 보험 .. 없이 종합보험만 가입하는게 맞....",
         "보험이 없어서 종합보험+실손 가입 문의 요청했으나 거절당했습니다", True),
    ]

    def test_kq4_approved_regression(self):
        for no, title, summary, clear in self.KQ4_APPROVED:
            i, why = kp.question_intent(title, summary)
            self.assertEqual(bool(i), clear, f"{no} {why}")
        i, _ = kp.question_intent(*self.KQ4_APPROVED[2][1:3])
        self.assertNotIn("고지", i["situations"])          # 「사고지만」은 고지가 아니다
        self.assertIn("거절·부지급", i["situations"])
        i, _ = kp.question_intent(*self.KQ4_APPROVED[0][1:3])
        self.assertIn("해당사항인가요?", i["ask"])            # 조각 속 질문자의 물음까지 넘긴다
        self.assertNotIn("진단·발견", i["situations"])       # 「무진단형」은 진단이 아니다

    def test_kq4_closings_end_with_next_step(self):
        """닫는 방식 9종이 모두 다음 할 일(서류·요청처)로 끝나게 지시한다 — 채택 기준 ③과 충돌하지 않게."""
        for c in kp._ts_array("KIN_CLOSINGS"):
            self.assertRegex(c, r"할 일|서류|요청|발급|받아 두|사본", c)

    def test_special_note_fits(self):
        for t in kh.TOPICS:
            self.assertLessEqual(len(kp.special_note(t).encode("utf-8")), kp.NOTE_MAX_BYTES)


class SyncWatcher(unittest.TestCase):
    def test_sync_no_duplicates(self):
        with tempfile.TemporaryDirectory() as d:
            st, wp = os.path.join(d, "s.json"), os.path.join(d, "w.json")
            kits = {k: {"id": k, "kin_answer_id": "u" + k, "status": "심의대기"} for k in ("a", "b", "c")}
            with open(st, "w", encoding="utf-8") as f:
                json.dump({"kits": kits}, f)
            rows = [{"심의번호": "2026-10-5017", "심의필일자": "2026-10-20", "유효기간": "2027-10-19", "게시위치등록됨": True, "키트id": "a"},
                    {"심의번호": "2026-10-4548", "심의필일자": "2026-10-19", "유효기간": "2027-10-18", "게시위치등록됨": True, "키트id": "b"},
                    {"심의번호": "", "키트id": "c"}, {"심의번호": "2026-10-4555", "키트id": "zz"}]
            with open(wp, "w", encoding="utf-8") as f:
                json.dump({"행": rows}, f)
            recs, posted = [], []
            rec_fn = lambda e, r, n, f, t: recs.append(n) or ("id" + n, "ok")  # noqa: E731
            kp.cmd_sync_watcher({}, path=wp, state_path=st, record=rec_fn,
                                existing_fn=lambda: {"2026-10-4548"}, mark_posted=lambda e, i: posted.append(i))
            self.assertEqual(recs, ["2026-10-5017"])      # 4548 은 이미 있어 건너뜀, 빈 번호·키트 없음도 건너뜀
            self.assertEqual(posted, ["ua"])
            self.assertEqual(kp.load_state(st)["kits"]["a"]["status"], "게시")
            again = kp.cmd_sync_watcher({}, path=wp, state_path=st, record=rec_fn,
                                        existing_fn=lambda: {"2026-10-4548", "2026-10-5017"}, mark_posted=lambda e, i: None)
            self.assertEqual(recs, ["2026-10-5017"])      # 재실행해도 새 행 0
            self.assertTrue(all("기록 2026" not in l for l in again))

    def test_sync_fills_posted_on_existing_row(self):
        """AR2 — 이미 있는 행이 url_registered_at 비었고 감시기가 게시위치등록됨 이면 한 번 채우고, 재실행엔 변화 0."""
        with tempfile.TemporaryDirectory() as d:
            st, wp = os.path.join(d, "s.json"), os.path.join(d, "w.json")
            kits = {k: {"id": k, "kin_answer_id": "u" + k, "status": "승인", "question_url": "https://kin.naver.com/q/" + k}
                    for k in ("a", "b", "c")}
            with open(st, "w", encoding="utf-8") as f:
                json.dump({"kits": kits}, f)
            rows = [{"심의번호": "2026-10-6031", "게시위치등록됨": True, "키트id": "a"},    # 비어 있음 → 채움
                    {"심의번호": "2026-10-6032", "게시위치등록됨": True, "키트id": "b"},    # 이미 채워짐 → 손대지 않음
                    {"심의번호": "2026-10-6033", "게시위치등록됨": False, "키트id": "c"}]  # 게시 전 → 손대지 않음
            with open(wp, "w", encoding="utf-8") as f:
                json.dump({"행": rows}, f)
            have = {"2026-10-6031", "2026-10-6032", "2026-10-6033"}
            pending = {"2026-10-6031": "ida", "2026-10-6033": "idc"}   # DB 에서 url_registered_at 이 빈 행
            regs, posted = [], []

            def reg(e, i, u):
                regs.append((i, u))
                for k in [k for k, v in pending.items() if v == i]:
                    del pending[k]   # DB 가 채워지면 다음 조회에서 빠진다
                return True

            def no_new_row(*a):
                self.fail("새 행을 만들면 안 된다")

            kw = dict(path=wp, state_path=st, record=no_new_row, existing_fn=lambda: have,
                      mark_posted=lambda e, i: posted.append(i), pending_fn=lambda: dict(pending), register_url=reg)
            out = kp.cmd_sync_watcher({}, **kw)
            self.assertEqual(regs, [("ida", "https://kin.naver.com/q/a")])
            self.assertEqual(posted, ["ua"])
            self.assertEqual(kp.load_state(st)["kits"]["a"]["status"], "게시")
            self.assertTrue(any("게시 반영 2026-10-6031" in l for l in out))
            again = kp.cmd_sync_watcher({}, **kw)
            self.assertEqual(regs, [("ida", "https://kin.naver.com/q/a")])   # 재실행 변화 0
            self.assertEqual(again, ["새 승인 없음"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
