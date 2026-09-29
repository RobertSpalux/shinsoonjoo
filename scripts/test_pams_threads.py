#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
스레드 접수 키트 테스트 — python scripts/test_pams_threads.py

robert-os 무인 게시 파이프라인(finance/threads_post.py)이 기대하는 형식을 고정한다.
네트워크·DB·Storage·로컬 서버는 전부 가짜.
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import pams_kit as kit  # noqa: E402
import pams_threads as th  # noqa: E402

ROBERT_OS_POST = r"D:\robert-os\finance\threads_post.py"
ENV = {"NEXT_PUBLIC_SUPABASE_URL": "https://p", "SUPABASE_SERVICE_ROLE_KEY": "k"}
MAIN_URL = "https://goodfinance.kr/news/caregiver-daily-benefit-support-vs-use"
BODY = "\"간병비보험 있으니까 간병인 쓰면 다 나오겠지.\"\n상담에서 자주 듣는 말입니다.\n\n" \
       "금융감독원 「주요 민원사례로 알아보는 소비자 유의사항 - 간병보험 관련 유의사항 -」(2025.4.8)에 따르면,\n" \
       "여러분 증권의 간병 담보는 어느 쪽인지 알고 계세요?"


PHOTO_BODY = "엄마가 31일 입원하셨다가 이틀 전에 퇴원하셨어요.\n" + BODY


def art(main_status=None, main_url=None, extra=()):
    reviews = list(extra)
    if main_status:
        reviews.append({"id": "m1", "channel": "main", "status": main_status, "posted_url": main_url,
                        "created_at": "2026-09-29"})
    return {"id": "a1", "slug": "caregiver-daily-benefit-support-vs-use", "ad_reviews": reviews}


class ReplyRuleTest(unittest.TestCase):
    def test_link_only_when_main_approved_and_posted(self):
        self.assertEqual(th.main_link(art("approved", MAIN_URL)), MAIN_URL)
        self.assertIsNone(th.main_link(art("submitted", MAIN_URL)), "심사중이면 댓글 없음")
        self.assertIsNone(th.main_link(art("approved", None)), "게시 URL 없으면 댓글 없음")
        self.assertIsNone(th.main_link(art()))

    def test_utm_url(self):
        self.assertEqual(th.reply_url(MAIN_URL + "?x=1", "abc-123"),
                         MAIN_URL + "?utm_source=threads&utm_campaign=abc-123")

    def test_phrase_rules(self):
        self.assertEqual(th.check_reply_phrase(th.REPLY_PHRASE), th.REPLY_PHRASE)
        for bad in ["궁금하시면 상담 문의 주세요", "무료로 점검해 드립니다", "타사와 비교해 보세요",
                    "반드시 확인하세요", "https://x.y 참고", "", "한 줄\n두 줄\n세 줄"]:
            with self.assertRaises(kit.KitError, msg=bad):
                th.check_reply_phrase(bad)

    def test_paste_format(self):
        reply = th.compose_reply(th.REPLY_PHRASE, MAIN_URL, "rid")
        self.assertEqual(th.compose_paste(BODY, reply), f"{BODY}\n\n[첫 댓글]\n{reply}")
        self.assertEqual(th.compose_paste(BODY, None), BODY, "댓글 없으면 본문만")

    def test_body_limits(self):
        th.check_body(BODY)
        with self.assertRaises(kit.KitError):
            th.check_body("가" * 501)
        with self.assertRaises(kit.KitError):
            th.check_body(BODY + "\n[첫 댓글]")
        with self.assertRaises(kit.KitError, msg="CRLF 는 sha256 이 심의본과 달라진다"):
            th.check_body(BODY.replace("\n", "\r\n"))


class NotesFormatTest(unittest.TestCase):
    def test_hashes_extracted_even_when_prior_note_mentions_reply_word(self):
        body, reply = BODY.encode(), "문구\nhttps://x".encode()
        prior = "pams_kit threads — 첫 댓글 이야기와 본문 이야기가 섞인 메모"
        notes = prior + "\n09-29 14:40 접수 원고 · " + th.notes_line("https://p.supabase.co", "rid", body, reply)
        self.assertEqual(th.NOTES_BODY_RX.search(notes).group(1), hashlib.sha256(body).hexdigest())
        self.assertEqual(th.NOTES_REPLY_RX.search(notes).group(1), hashlib.sha256(reply).hexdigest())
        self.assertIn("/storage/v1/object/public/card-news/threads/rid/body.txt", notes)

    def test_no_reply_means_no_reply_hash(self):
        notes = th.notes_line("https://p.supabase.co", "rid", b"x", None)
        self.assertIsNone(th.NOTES_REPLY_RX.search(notes))

    @unittest.skipUnless(os.path.exists(ROBERT_OS_POST), "robert-os 저장소 없음")
    def test_regex_matches_robert_os(self):
        src = open(ROBERT_OS_POST, encoding="utf-8").read()
        for name, mine in (("BODY_SHA_RX", th.NOTES_BODY_RX), ("REPLY_SHA_RX", th.NOTES_REPLY_RX)):
            m = re.search(name + r'\s*=\s*re\.compile\(r"([^"]+)"\)', src)
            self.assertIsNotNone(m, name)
            self.assertEqual(m.group(1), mine.pattern, f"{name} 가 robert-os 와 다르다")


class KitBuildTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.body = os.path.join(self.dir, "body.txt")
        with open(self.body, "w", encoding="utf-8", newline="") as fp:
            fp.write(BODY)
        self.created = []
        self._saved = (kit.gate, kit.preview_url, th.ensure_draft_row, th.banned_hits)
        kit.gate = lambda url: "<html>ok</html>"
        kit.preview_url = lambda srv, env, slug: "http://x"
        th.ensure_draft_row = lambda env, a: (self.created.append(a["id"]) or ("rid-9", True))
        th.banned_hits = lambda text: []

    def tearDown(self):
        kit.gate, kit.preview_url, th.ensure_draft_row, th.banned_hits = self._saved

    class _Srv:
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def build(self, a):
        return th.build_threads_kit({}, a, body_path=self.body, server=self._Srv(), out_dir=self.dir)

    def test_no_reply_when_main_not_approved(self):
        k = self.build(art("submitted", MAIN_URL))
        self.assertIsNone(k["reply"])
        self.assertEqual(self.created, [], "댓글이 없으면 DB 에 행을 만들지 않는다")
        names = zipfile.ZipFile(k["zip"]).namelist()
        self.assertNotIn("reply.txt", names)
        self.assertNotIn("body.txt", names)
        self.assertEqual(open(os.path.join(k["sidecar"], "body.txt"), encoding="utf-8", newline="").read(), BODY,
                         "본문 바이트 그대로(zip 밖)")
        self.assertFalse(os.path.exists(os.path.join(k["sidecar"], "reply.txt")))
        self.assertEqual(k["paste"], BODY)
        self.assertTrue(any(n.startswith("금융감독원, 주요 민원사례로") for n in names), "증빙 동봉")
        self.assertTrue(k["name"].endswith("_6호_스레드.zip"))

    def test_reply_when_main_approved(self):
        k = self.build(art("approved", MAIN_URL))
        self.assertEqual(self.created, ["a1"])
        z = zipfile.ZipFile(k["zip"])
        meta, body, reply_b, _ = th.read_kit_parts(k["zip"])
        reply = reply_b.decode()
        self.assertTrue(reply.endswith(MAIN_URL + "?utm_source=threads&utm_campaign=rid-9"))
        self.assertEqual(meta["row_id"], "rid-9")
        self.assertEqual(z.read("스레드 접수 원고.txt").decode(), f"{BODY}\n\n[첫 댓글]\n{reply}",
                         "첫 댓글은 원고 txt 안의 「[첫 댓글]」 블록으로")
        self.assertEqual(sorted(n for n in z.namelist() if n.endswith(".txt")), ["스레드 접수 원고.txt"])

    def test_zip_holds_only_review_targets(self):
        """PAMS 첨부 zip = 원고 txt 1개 + (사진) + 증빙. kit.json·body.txt·reply.txt 는 zip 밖."""
        for a in (art("submitted", MAIN_URL), art("approved", MAIN_URL)):
            k = self.build(a)
            names = zipfile.ZipFile(k["zip"]).namelist()
            for inner in ("kit.json", "body.txt", "reply.txt"):
                self.assertNotIn(inner, names)
            self.assertEqual([n for n in names if n.endswith(".txt")], ["스레드 접수 원고.txt"], "원고 txt 정확히 1개")
            self.assertTrue(all(n.endswith((".txt", ".pdf", ".jpg", ".jpeg", ".png")) for n in names), names)
            self.assertTrue(os.path.isfile(os.path.join(k["sidecar"], "kit.json")))
            self.assertIn(k["sidecar"], open(k["txt"], encoding="utf-8").read())

    def test_read_kit_parts_stops_when_paste_and_body_differ(self):
        k = self.build(art("submitted", MAIN_URL))
        with open(os.path.join(k["sidecar"], "body.txt"), "wb") as fp:
            fp.write(("다른 본문" + BODY).encode())
        with self.assertRaises(kit.KitError):
            th.read_kit_parts(k["zip"])

    def test_gate_blocks(self):
        def blocked(url):
            raise kit.KitError("확인 미완료", gate=True)
        kit.gate = blocked
        with self.assertRaises(kit.KitError):
            self.build(art("approved", MAIN_URL))
        self.assertEqual(self.created, [], "게이트에 막히면 행도 만들지 않는다")


class UploadTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.up, self.patched = [], []
        self._saved = (th._upload, th.requests.patch)
        th._upload = lambda env, path, data, ct: (self.up.append((path, data)) or f"https://p/{path}")

        class R:
            status_code = 204
            text = ""
        th.requests.patch = lambda url, params=None, json=None, headers=None, timeout=None: (
            self.patched.append((params, json)) or R())

    def tearDown(self):
        th._upload, th.requests.patch = self._saved

    def zip_(self, row_id, reply=True):
        p = os.path.join(self.d, "k.zip")
        with zipfile.ZipFile(p, "w") as z:
            z.writestr("body.txt", BODY.encode())
            if reply:
                z.writestr("reply.txt", "문구\nhttps://x".encode())
            z.writestr("kit.json", json.dumps({"slug": "caregiver-daily-benefit-support-vs-use", "row_id": row_id}))
        return p

    def test_uploads_to_row_id_folder_and_marks_submitted(self):
        a = art(extra=[{"id": "rid-9", "channel": "threads", "status": "draft", "notes": "첫 댓글 메모"}])
        th.upload_submitted(ENV, a, self.zip_("rid-9"))
        self.assertEqual([u[0] for u in self.up], ["card-news/threads/rid-9/body.txt", "card-news/threads/rid-9/reply.txt"])
        params, body = self.patched[0]
        self.assertEqual(params, {"id": "eq.rid-9"})
        self.assertEqual(body["status"], "submitted")
        self.assertEqual(th.NOTES_BODY_RX.search(body["notes"]).group(1), hashlib.sha256(BODY.encode()).hexdigest())
        self.assertEqual(th.NOTES_REPLY_RX.search(body["notes"]).group(1),
                         hashlib.sha256("문구\nhttps://x".encode()).hexdigest(),
                         "앞 메모의 「댓글」 낱말이 본문 해시를 댓글 해시로 잡으면 안 된다")

    def test_refuses_approved_or_already_hashed(self):
        a = art(extra=[{"id": "rid-9", "channel": "threads", "status": "approved", "notes": ""}])
        with self.assertRaises(kit.KitError):
            th.upload_submitted(ENV, a, self.zip_("rid-9"))
        a = art(extra=[{"id": "rid-9", "channel": "threads", "status": "submitted",
                        "notes": "본문 https://x (sha256 74ed2e9c7b937248)"}])
        with self.assertRaises(kit.KitError):
            th.upload_submitted(ENV, a, self.zip_("rid-9"))
        self.assertEqual(self.up, [], "거절하면 아무것도 올리지 않는다")

    def test_new_format_kit_reads_sidecar(self):
        """새 키트: zip 에는 원고 txt 뿐, body/reply/kit.json 은 <키트이름>.kit/ — 해시·업로드는 그대로."""
        p = os.path.join(self.d, "n.zip")
        reply = "문구\nhttps://x"
        with zipfile.ZipFile(p, "w") as z:
            z.writestr("스레드 접수 원고.txt", f"{BODY}\n\n[첫 댓글]\n{reply}".encode())
        side = th.sidecar_dir(p)
        os.makedirs(side)
        for n, data in (("body.txt", BODY.encode()), ("reply.txt", reply.encode()),
                        ("kit.json", json.dumps({"slug": "caregiver-daily-benefit-support-vs-use",
                                                 "row_id": "rid-9"}).encode())):
            with open(os.path.join(side, n), "wb") as fp:
                fp.write(data)
        a = art(extra=[{"id": "rid-9", "channel": "threads", "status": "draft", "notes": ""}])
        th.upload_submitted(ENV, a, p)
        self.assertEqual([u[0] for u in self.up], ["card-news/threads/rid-9/body.txt", "card-news/threads/rid-9/reply.txt"])
        self.assertEqual(self.up[0][1], BODY.encode(), "sidecar 본문 바이트 그대로 올린다")
        notes = self.patched[0][1]["notes"]
        self.assertEqual(th.NOTES_BODY_RX.search(notes).group(1), hashlib.sha256(BODY.encode()).hexdigest())
        self.assertEqual(th.NOTES_REPLY_RX.search(notes).group(1), hashlib.sha256(reply.encode()).hexdigest())

    def test_no_reply_kit_uses_latest_submitted_row(self):
        a = art(extra=[{"id": "old", "channel": "threads", "status": "approved", "notes": "본문 u (sha256 aaaaaaaaaaaaaaaa)",
                        "created_at": "2026-09-01"},
                       {"id": "new", "channel": "threads", "status": "submitted", "notes": "", "created_at": "2026-09-29"}])
        th.upload_submitted(ENV, a, self.zip_(None, reply=False))
        self.assertEqual([u[0] for u in self.up], ["card-news/threads/new/body.txt"])


class PhotoStageTest(unittest.TestCase):
    """사진은 광고 내용 — 키트에 넣어 심의. --stage 는 준비 id 폴더에 미리 올린다(ad_reviews 는 안 만든다)."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.body = os.path.join(self.d, "body.txt")
        with open(self.body, "w", encoding="utf-8", newline="") as fp:
            fp.write(PHOTO_BODY)
        self.photos = []
        for n in ("photo1.jpg", "photo2.jpg"):
            p = os.path.join(self.d, n)
            with open(p, "wb") as fp:
                fp.write(n.encode())
            self.photos.append(p)
        self.up, self.rows = [], []
        self._saved = (kit.gate, kit.preview_url, th.ensure_draft_row, th.banned_hits, th._upload,
                       th._insert_submitted_row, th.requests.patch)
        kit.gate = lambda url: "ok"
        kit.preview_url = lambda srv, env, slug: "http://x"
        th.ensure_draft_row = lambda env, a: self.fail("댓글 없으면 행을 만들면 안 된다")
        th.banned_hits = lambda text: []
        th._upload = lambda env, path, data, ct: (self.up.append((path, ct)) or f"https://p/{path}")
        self.titles = []
        th._insert_submitted_row = lambda env, a, pid, title=th.THREADS_PROFILE: (
            self.rows.append(pid) or self.titles.append(title) or
                                                         {"id": pid, "channel": "threads", "status": "submitted", "notes": ""})

        class R:
            status_code = 204
            text = ""
        self.patched = []
        th.requests.patch = lambda url, params=None, json=None, headers=None, timeout=None: (
            self.patched.append(json) or R())

    def tearDown(self):
        (kit.gate, kit.preview_url, th.ensure_draft_row, th.banned_hits, th._upload,
         th._insert_submitted_row, th.requests.patch) = self._saved

    class _Srv:
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def build(self, stage):
        return th.build_threads_kit(ENV, art("submitted", MAIN_URL), body_path=self.body, server=self._Srv(),
                                    out_dir=self.d, photos=self.photos, stage_upload=stage)

    def test_photos_in_kit_in_order_no_notice(self):
        k = self.build(stage=False)
        z = zipfile.ZipFile(k["zip"])
        self.assertIn("photo1.jpg", z.namelist())
        self.assertIn("photo2.jpg", z.namelist())
        self.assertNotIn("notice.png", z.namelist(), "필수안내 이미지는 접수 시 불필요")
        self.assertEqual(th.read_kit_parts(k["zip"])[0]["photos"], ["photo1.jpg", "photo2.jpg"])
        self.assertEqual([n for n in z.namelist() if n.endswith(".txt")], ["스레드 접수 원고.txt"])
        self.assertNotIn("kit.json", z.namelist())
        self.assertNotIn("body.txt", z.namelist())
        self.assertIsNone(k["prep_id"])
        self.assertEqual(self.up, [], "--stage 없으면 올리지 않는다")
        txt = open(k["txt"], encoding="utf-8").read()
        self.assertIn("필수안내 이미지: 접수 시 불필요 — 승인 후 robert-os 가 번호 넣어 생성", txt)
        self.assertIn("photo1.jpg → photo2.jpg", txt)

    def test_stage_uploads_body_and_photos_to_prep_folder(self):
        k = self.build(stage=True)
        pid = k["prep_id"]
        self.assertTrue(re.fullmatch(r"[0-9a-f-]{36}", pid))
        self.assertEqual([u[0] for u in self.up], [f"card-news/threads/{pid}/body.txt",
                                                   f"card-news/threads/{pid}/photo1.jpg",
                                                   f"card-news/threads/{pid}/photo2.jpg"])
        self.assertEqual(self.up[1][1], "image/jpeg")
        self.assertEqual(self.rows, [], "--stage 는 ad_reviews 를 만들지 않는다")

    def test_submitted_creates_row_with_prep_id_and_keeps_hash_lines_parseable(self):
        k = self.build(stage=True)
        self.up.clear()
        th.upload_submitted(ENV, art("submitted", MAIN_URL), k["zip"])
        self.assertEqual(self.rows, [k["prep_id"]], "준비 id 로 행을 만든다(폴더와 id 일치)")
        self.assertEqual(self.titles, ["엄마가 31일 입원하셨다가 이틀 전에 퇴원하셨어요."],
                         "사진 경로 행의 posting_title 은 PAMS 게시명(본문 첫 줄)")
        notes = self.patched[0]["notes"]
        self.assertEqual(th.NOTES_BODY_RX.search(notes).group(1), hashlib.sha256(PHOTO_BODY.encode()).hexdigest())
        self.assertIsNone(th.NOTES_REPLY_RX.search(notes), "사진 줄이 댓글 해시로 잡히면 안 된다")
        self.assertIn("사진 photo1.jpg", notes)

    def test_custom_name_and_reused_prep_id(self):
        pid = "7325c366-463e-4c8f-8e85-998e29cc9f04"
        k = th.build_threads_kit(ENV, art("submitted", MAIN_URL), body_path=self.body, server=self._Srv(),
                                 out_dir=self.d, photos=self.photos, stage_upload=True,
                                 name="0929_스레드_간병가족", prep_id=pid)
        self.assertTrue(k["zip"].endswith("0929_스레드_간병가족.zip"))
        self.assertEqual(k["prep_id"], pid, "준비 id 를 다시 쓴다(같은 폴더)")
        self.assertTrue(all(u[0].startswith(f"card-news/threads/{pid}/") for u in self.up))
        for bad_name in ("../x", "a b", "x" * 61):
            with self.assertRaises(kit.KitError):
                th.build_threads_kit(ENV, art("submitted", MAIN_URL), body_path=self.body, server=self._Srv(),
                                     out_dir=self.d, name=bad_name)
        with self.assertRaises(kit.KitError):
            th.build_threads_kit(ENV, art("submitted", MAIN_URL), body_path=self.body, server=self._Srv(),
                                 out_dir=self.d, stage_upload=True, prep_id="not-a-uuid")

    def test_photo_route_splits_title_location_spec(self):
        """사진 있음 = 일반심의 → 업무광고 → 스레드: 게시명·게시위치·규격이 각각 다른 줄."""
        k = self.build(stage=False)
        txt = open(k["txt"], encoding="utf-8").read()
        self.assertIn("\n게시명: 엄마가 31일 입원하셨다가 이틀 전에 퇴원하셨어요.\n", txt)
        self.assertIn("\n게시위치: https://www.threads.com/@goodfinance_sj\n", txt)
        self.assertIn("\n규격: 스레드 텍스트 + 이미지 2장\n", txt)
        self.assertNotIn("게시명: https://", txt)
        self.assertEqual(k["title"], "엄마가 31일 입원하셨다가 이틀 전에 퇴원하셨어요.")
        meta = th.read_kit_parts(k["zip"])[0]
        self.assertEqual(meta["posting_title"], k["title"])

    def test_photo_route_forbidden_char_in_first_line_stops(self):
        for ch in ("'", "?", '"', "&"):
            with open(self.body, "w", encoding="utf-8", newline="") as fp:
                fp.write(f"첫 줄{ch} 입니다\n" + BODY)
            with self.assertRaises(kit.KitError, msg=ch):
                self.build(stage=False)

    def test_text_only_route_keeps_url_as_title(self):
        """텍스트만 = 스레드 전용 경로: 칸이 하나라 종전대로 게시명 = 계정 URL, 게시위치 줄 없음."""
        f = th.posting_fields(BODY, 0)
        self.assertEqual(f, {"게시명": th.THREADS_PROFILE})
        f2 = th.posting_fields(PHOTO_BODY, 3)
        self.assertEqual(f2["규격"], "스레드 텍스트 + 이미지 3장")
        self.assertEqual(f2["게시위치"], th.THREADS_PROFILE)

    def test_bad_photo_rejected(self):
        with self.assertRaises(kit.KitError):
            th.check_photos([self.body])
        with self.assertRaises(kit.KitError):
            th.check_photos([os.path.join(self.d, "없음.jpg")])


if __name__ == "__main__":
    unittest.main(verbosity=2)
