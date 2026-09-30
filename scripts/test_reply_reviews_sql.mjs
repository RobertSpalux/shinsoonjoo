// sql/005_reply_reviews.sql 을 진짜 Postgres(PGlite — 메모리 안 WASM)에 올려 제약·트리거를 시험한다. 운영 DB 는 건드리지 않는다.
//   node scripts/test_reply_reviews_sql.mjs [PGlite 가 설치된 폴더]
//   PGlite 는 저장소 의존성에 넣지 않았다: 임시 폴더에서 `npm i @electric-sql/pglite@0.2` 후 그 폴더를 인자로.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import crypto from "crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const where = process.argv[2] || process.cwd();
const require = createRequire(path.join(where, "package.json"));
const { PGlite } = require("@electric-sql/pglite");
const sql = fs.readFileSync(path.join(here, "..", "sql", "005_reply_reviews.sql"), "utf8");

const R = []; const ok = (n, c, x) => R.push([c ? "PASS" : "FAIL", n, x ?? ""]);
const db = new PGlite();
const sha = t => crypto.createHash("sha256").update(t, "utf8").digest("hex");
async function fails(q, params, rx) {
  try { await db.query(q, params); return false; } catch (e) { return rx ? rx.test(String(e.message)) : true; }
}
try {
  await db.exec(sql);
  ok("마이그레이션 적용", true);
  await db.exec(sql);
  ok("두 번 적용해도 오류 없음(if not exists · or replace)", true);

  const T = "읽어 주셔서 고맙습니다.";
  let r = await db.query("insert into reply_reviews (root_post_id, comment_id, reply_text, reply_sha256) values ('P1','C1',$1,'가짜') returning id, reply_sha256, status", [T]);
  const id = r.rows[0].id;
  ok("해시는 트리거가 계산한다(넣은 값 무시)", r.rows[0].reply_sha256 === sha(T), r.rows[0].reply_sha256);
  ok("기본 상태 = 초안", r.rows[0].status === "초안");

  ok("없는 상태 거절", await fails("update reply_reviews set status='게시' where id=$1", [id], /status_chk/));
  ok("같은 댓글에 살아 있는 원고 두 개 거절", await fails("insert into reply_reviews (root_post_id, comment_id, reply_text) values ('P1','C1','다른 원고')", [], /active_uniq/));

  await db.query("update reply_reviews set reply_text=$2 where id=$1", [id, T + " "]);
  r = await db.query("select reply_sha256 from reply_reviews where id=$1", [id]);
  ok("초안일 때는 원고를 고칠 수 있고 해시가 따라간다", r.rows[0].reply_sha256 === sha(T + " "));
  await db.query("update reply_reviews set reply_text=$2, status='심의대기', pams_submitted_at=now() where id=$1", [id, T]);
  ok("심의대기 뒤 원고 변경 거절", await fails("update reply_reviews set reply_text='바꿈' where id=$1", [id], /원안 변경 금지/));

  ok("승인에는 심의필·기간·필수안내가 있어야 한다", await fails("update reply_reviews set status='승인' where id=$1", [id], /approved_needs_review/));
  ok("심의필 형식 검사(접두·접미 붙인 값 거절)", await fails("update reply_reviews set review_no='제2026-10-1234호' where id=$1", [id], /review_no_fmt/));
  await db.query("update reply_reviews set status='승인', review_no='2026-10-1234', review_from='2026-10-01', review_to='2027-09-30', notice_text='필수안내', pams_approved_at=now() where id=$1", [id]);
  ok("승인 저장", true);

  ok("답함: 게시 해시가 없으면 거절", await fails("update reply_reviews set status='답함', posted_at=now() where id=$1", [id], /posted_matches/));
  ok("답함: 게시 본문이 심의본과 한 글자라도 다르면 거절", await fails("update reply_reviews set status='답함', posted_at=now(), posted_sha256=$2 where id=$1", [id, sha(T + ".")], /posted_matches/));
  await db.query("update reply_reviews set status='답함', posted_at=now(), posted_sha256=$2, posted_reply_id='R1' where id=$1", [id, sha(T)]);
  ok("답함: 해시 일치 시 저장", true);
  ok("답함에서 되돌리기 거절", await fails("update reply_reviews set status='승인' where id=$1", [id], /되돌리지 않는다/));

  await db.query("insert into reply_reviews (root_post_id, comment_id, reply_text, status) values ('P1','C2','반송된 원고','반송')");
  await db.query("insert into reply_reviews (root_post_id, comment_id, reply_text) values ('P1','C2','고친 원고')");
  ok("반송된 원고가 있어도 새 원고는 들어간다(신규 심의)", true);
  ok("RLS 켜짐", (await db.query("select relrowsecurity from pg_class where relname='reply_reviews'")).rows[0].relrowsecurity === true);
} catch (e) {
  ok("실행 오류 없음", false, String(e && e.message || e));
}
R.forEach(r => console.log(r[0], r[1], r[0] === "FAIL" ? "— " + r[2] : ""));
const f = R.filter(r => r[0] === "FAIL").length;
console.log(`test_reply_reviews_sql ${R.length - f}/${R.length}` + (f ? " ✗" : " PASS"));
process.exit(f ? 1 : 0);
