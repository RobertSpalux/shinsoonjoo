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
2. 실측 뒤 `pams_apply` 에 지식인 경로 — 키트 `PAMS접수\_지식인\*.txt` 의 「카테고리:」「특이사항:」 줄과
   `── PAMS 에 붙여 넣을 원고 ──` 블록을 읽어 채운다. 🔴 저장·제출·자가점검 금지(기존 AST 시험 그대로).
   카테고리를 고르면 자동생성 칸이 채워지므로 **카테고리를 먼저**, 원고는 그 다음.
3. 승인 감시 — 목록 「구분=댓글」 행의 `upviewji` 상세 화면 「답변내용」 전문을 `finance/state/pams_kin_승인.json`
   `{"<키트id>": {"심의필번호", "시작", "종료", "답변내용"}}` 로 남기면 `kin_pipeline.py approvals` 가 집어 간다.
   (그 전까지는 로버트가 「지식인&댓글 엑셀변환」을 내려받아 `approvals --xls` 로.)

## 아직 모르는 것

- [미확정] 지식인 심의가 「[심사중] 3건」 한도에 들어가는가(댓글심의는 한도 밖, §6.4). 신청현황 화면·공지로 확인.
- [미확정] 「유병자보험」 카테고리 자동생성분에 `유병자(간편) 보험은 인수기준에 따라…` 문구가 있는가 — 있으면 우리 블록에서 뺀다.
- [미확정] 엑셀변환 파일 형식(HTML 표 / xlsx / 구형 xls). 셋 다 읽도록 했고, 구형 xls 는 xlrd 가 없으면 xlsx 로 저장해 달라고 멈춘다.
- [제안] `sql/006_ad_reviews_kin.sql` — 적용 전 ad_reviews 를 article 조인으로 읽는 곳(어드민·publish_approved·
  pams_queue·weekly_lead_report)이 `article_id` NULL 행에서 깨지지 않는지 확인 필요.
