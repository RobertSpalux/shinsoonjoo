# 지식iN 답변 파이프라인 (2026-10-09 신설 · TICKET 20261009-SH3)

로버트 결정(10/09): 선한금융 유입 주력을 네이버 지식iN 답변으로. 하루 3~5건, 로버트 손은 PAMS 「제출」과 지식iN 붙여넣기만.

```
kin_harvest.py   네이버 검색 API(kin) → 우리 소재 질문 후보        (로그인·스크래핑 없음)
kin_pipeline.py run
  ├ pick          하루 5건 · 같은 소재 하루 1건 · 직전 날 마지막 소재 연속 금지 · 이미 다룬 질문 제외
  ├ kin_draft.mts 답변 본문(factory-prompt kinPipelineSystemPrompt)
  ├ check_kin.mts 게이트(src/lib/compliance/kin-terms.ts) — 걸리면 사유를 주고 처음부터 1회 재작성, 또 걸리면 버림
  ├ kin_answers   「초안」 행(어드민 지식iN 탭에 보임)
  ├ 키트 txt      Downloads\PAMS접수\_지식인\MMDD_지식인_<docId>.txt   ← PAMS 폼에 옮길 값 + 원고
  └ 텔레그램      「지식인 심의 접수 대기 N건 — 제출은 로버트」(pams_auto.telegram, Soonjoo_PB 방)
(로버트) PAMS 지식인 심의 폼에 옮김 → 자가점검 → 「제출」   🔴 「저장」 금지
kin_pipeline.py approvals --xls <지식인&댓글 엑셀변환>        ← 승인 수거(또는 approve 를 손으로)
  └ 게시본 txt + 텔레그램 「그대로 복사해 지식iN 에 붙여 넣기」 + ad_reviews(channel=kin, sql/006 적용 뒤)
(로버트) 지식iN 에 붙여넣기 → kin_pipeline.py posted <키트id> --url <답변 URL>
kin_pipeline.py weekly   성적표 한 줄
```

## 규칙의 근거

- 지식인·카페·커뮤니티 댓글 = 업무광고, 회사 기준은 전부 사전심의(GA협회 공문 2025-08-18, CLAUDE.md §6.2).
- 지식인 폼 실물(`jumgumpyoji.jsp?nums=1`): 손보/생보 · 광고형태 「바이럴(지식in)」 고정 · 게시위치 기본값
  「네이버 지식인」 · 카테고리 6종 → 고르면 안내문구+필수안내사항 **자동생성** · 본문 에디터 · 자가점검표 팝업 ·
  특이사항 · zip 첨부(증빙 있을 때만). 반송 = 재심의 불가, 신규 신청.
- 신청 버튼 팝업 금지표현 5항(자동 거절 + 작성 내용 삭제, 완료 후에도 시정요구) → `kin-terms.ts` 가
  `reply-terms.ts`(댓글심의 게이트)를 그대로 부른다: ① 회사·상품 유추 ② 과장·단정 ③ 산출기준 없는·대략 보험료
  ④ 비방·비교 ⑤ 질문자 개인정보·민감정보(질문의 병명 되받기 포함).
- 지식iN 전용으로 더한 것: 링크 일체 금지 · 본문 600~900자 · 되묻기 금지 · 일화 날조 금지 · 개인 의견 귀속 1회 ·
  경어체 · 실손 주제면 `ACTUAL_LOSS_NOTICE`, 간편·유병자면 `simplifiedIssue` 정본 그대로.
- 개인의견·약관참조 문구와 필수안내사항은 **PAMS 자동생성분**을 쓴다(우리 `REQUIRED_NOTICES` 를 덧붙이지 않는다 —
  같은 뜻이 다른 자구로 두 번 나간다). 게시문 원본 = 승인 뒤 「심의내용」 돋보기 화면(답변+안내문구+필수안내사항).
- 원고는 외부에서 완성 → 게이트 통과 → 붙여넣기. 폼에 직접 고쳐 쓰지 않는다.

## 수집기가 모르는 것(지어내지 않는다)

검색 API 응답은 `title·link·description` 뿐이다(2026-10-09 실측).
- 작성일 없음 → 「72시간」 = 우리 대장(`%LOCALAPPDATA%\SHIN\kin_seen.json`)의 **첫 관측** 기준. 첫 실행은 기준선만 적는다.
- 채택·마감 여부 없음 → 「마감: 미확인」. 게시 전에 화면에서 본다.
- 답변 수 없음 → link 의 `answerNo` 최댓값을 하한으로(≥3 이면 「답변 다수」 제외).
- 질문 본문 전문 없음 → description 조각(남의 답변일 수 있음)만 초안기에 준다.
- 질문 상세 페이지 GET 은 하지 않는다 — `kin.naver.com/robots.txt` 를 확인하지 못했다.

## robert-os 할 일(이 저장소 밖)

1. **지식인 폼 칸 실측** — `pams_apply.폼덤프()` 를 `jumgumpyoji.jsp?nums=1` 로 한 번(읽기만). 카테고리 라디오
   name/value, 손보/생보 select, 게시위치 input, 에디터(iframe 여부), 자동생성 textarea, 특이사항, 자가점검 버튼.
2. 실측 뒤 `pams_apply` 에 지식인 경로 — 키트 `PAMS접수\_지식인\*.txt`(형식은 아래 「키트 txt 형식」)의
   「카테고리:」「특이사항:」 줄과 `── PAMS 에 붙여 넣을 원고 ──` 블록을 읽어 채운다. 🔴 저장·제출·자가점검 금지(기존 AST 시험 그대로).
   카테고리를 고르면 자동생성 칸이 채워지므로 **카테고리를 먼저**, 원고는 그 다음.
3. 승인 감시 — 목록 「구분=댓글」 행의 `upviewji` 상세 화면 「답변내용」 전문을 `finance/state/pams_kin_승인.json`
   `{"<키트id>": {"심의필번호", "시작", "종료", "답변내용"}}` 로 남기면 `kin_pipeline.py approvals` 가 집어 간다.
   (그 전까지는 로버트가 「지식인&댓글 엑셀변환」을 내려받아 `approvals --xls` 로.)

## 키트 txt 형식 (확정 SH4 2026-10-09 — `test_kin_pipeline` 이 지킨다)

```
[PAMS 접수 문자열] 지식인 · <소재> · <키트id>
심의유형: 지식인
손보/생보: 손보
광고형태: 바이럴(지식in)
게시위치: 네이버 지식인
카테고리: <6종 라벨 중 하나 — 유병자보험 | 그외 기타(건강,화재,펫 보험 등)>
특이사항: <100바이트 이내>
파일첨부: 없음
지식iN 질문: <질문 URL — PAMS 칸 아님>
원고해시: sha256 <64hex>
                                             ← 빈 줄 = 필드 블록 끝
── 안내(사람용) ── …                          ← 기계는 읽지 않는다
── 질문 제목(참고) ── / ── 질문 요약(참고 …) ──  ← PAMS 에 넣지 않는다
── PAMS 에 붙여 넣을 원고 ──
<답변내용 에디터에 넣을 원고 — 바이트 그대로>
── 끝 ──
```

- 필드 블록은 2줄부터 빈 줄까지, 순서 고정(`kin_pipeline.KIT_FIELDS`). 줄마다 `이름: 값` 하나, **값 뒤 설명 없음**
  (본진 키트 「게시위치:」「규격:」 줄과 같은 규칙). 값은 첫 `": "` 뒤 전부.
- 카테고리 값은 폼 라벨 글자 그대로다. 라디오 name/value 는 robert-os 실측 뒤 라벨→value 표로 바꾼다.
- 원고 블록 = 마커 다음 줄부터 `── 끝 ──` 앞 줄까지. sha256(원고) = 「원고해시」(심의본 대조).

## ad_reviews 와 지식iN (sql/006 — 관제탑 적용 대기)

**식별 키 하나:** 지식iN 행은 `channel = 'kin'` 으로만 가른다. `review_type` 은 PAMS 심의유형 축이라 기존 값 `'jisikin'`
(어드민 `REVIEW_TYPES`)을 쓴다 — 006 체크가 kin 행에 `review_type='jisikin'`·`kin_answer_id` 필수·`article_id` NULL 을 건다.
글 기준으로 읽는 곳은 전부 `channel=neq.kin`(`pams_kit.NOT_KIN`, 어드민은 `.neq("channel","kin")`) — `scripts/test_not_kin.py`.

| 읽는 곳 | 글 조인 방식 | kin 행(article_id NULL)이 섞이면 | 조치 |
|---|---|---|---|
| `publish_approved.fetch_rows` (pams_auto 10분 주기) | `{x["article_id"]}` 를 `sorted()` → `in.(…)` | **TypeError — 승인→게시·만료·미등록 알림 전부 멈춤** | NOT_KIN |
| `publish_approved.fetch_pending` | `premium_articles(slug,title)` 임베드 | 제목 없는 「심사 72시간+」 알림 | NOT_KIN |
| `publish_approved.fetch_main_rows` | `channel=eq.main` | 해당 없음 | — |
| `pams_queue.fetch_reviews` | 임베드 slug | 심사중 칸 계산에 섞임 · 1000행 한도 | NOT_KIN |
| `pams_submissions.fetch_reviews` (전 행 조회) | 임베드 slug | **1000행 한도에 글 행이 잘림 → 이미 있는 행을 「없음」으로 보고 중복 생성** | NOT_KIN |
| `pams_folder_tidy.fetch_rows` | 임베드 slug, 없으면 건너뜀 | 1000행 한도 | NOT_KIN |
| `review_lock.fetch_locked_rows` | `channel=in.(main,naver)` | 해당 없음 | — |
| `pams_auto` 스레드 업로드 | `channel=eq.threads` | 해당 없음 | — |
| `weekly_lead_report.review_counts` | 조인 없음(건수) | 글 승인 건수에 하루 3~5건 섞임 | NOT_KIN(지식iN 은 `kin_pipeline weekly`) |
| `content_analysis.db_reviews_and_titles` | `titles.get(article_id)` | 제목 없는 줄 · 1000행 한도 | NOT_KIN |
| `pams_kit`·`preflight`·`topic_guard` | `premium_articles(…, ad_reviews(…))` 역임베드 | 글 없는 행은 안 따라옴 | — |
| 어드민 `admin/page.tsx` ad_reviews | 최신 500행 | **글 행이 500행 밖으로 밀려 승인 글이 「미심의」로 보임** | `.neq("channel","kin")` |
| 어드민 `ad_reviews_expiring` 뷰 | 뷰 정의 미확인(DB 읽기 권한 없음) | inner join 이면 빠짐 · left join 이면 제목 없는 배지 | `.neq("channel","kin")` |
| 어드민 `AdminDashboard.reviewsByArticle` | `m.get(r.article_id)` | `null` 키 한 칸에 몰림 | `article_id` 없으면 건너뜀 |
| `ad-review`·`update`·`compose` API, `lib/ad-reviews.ts` | `eq("article_id", id)` | 해당 없음 | — |
| DB `has_valid_review`·`enforce_publish_gate` | (article, channel) | 해당 없음 | — |
| robert-os `pams_watch`(저장소 밖) | PAMS 목록 ↔ ad_reviews 짝짓기 | **미확인** — kin 행(구분=댓글)을 글 행과 짝지으려 하는지 | 관제탑 확인 |

⚠️ **순서:** 이 PR(필터)이 머지·배포된 **뒤에** 006 을 적용한다. 거꾸로면 kin 행 1건에 publish_approved 가 멈춘다.
⚠️ **지식iN 만료 관리(§6.3)** 는 어드민 배지·publish_approved 만료 알림에서 뺐다(하루 3~5건이라 배지를 덮는다).
1년 뒤(첫 만료 2027-10)까지 `kin_pipeline` 에 「만료 30일 이내 N건」 요약 한 줄을 붙인다 — 미구현.

## 아직 모르는 것

- [미확정] 지식인 심의가 「[심사중] 3건」 한도에 들어가는가(댓글심의는 한도 밖, §6.4). 신청현황 화면·공지로 확인.
  kin_pipeline 은 kin 행을 승인 뒤에만(`approved`) 넣으므로 지금은 어느 쪽이든 pams_queue 칸 계산에 영향 없다.
  한도에 든다고 확인되면 심사중 지식인 건을 따로 세야 한다.
- [미확정] 「유병자보험」 카테고리 자동생성분에 `유병자(간편) 보험은 인수기준에 따라…` 문구가 있는가 — 있으면 우리 블록에서 뺀다.
- [미확정] 엑셀변환 파일 형식(HTML 표 / xlsx / 구형 xls). 셋 다 읽도록 했고, 구형 xls 는 xlrd 가 없으면 xlsx 로 저장해 달라고 멈춘다.
