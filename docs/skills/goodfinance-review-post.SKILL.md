---
name: "goodfinance-review-post"
description: "선한금융(goodfinance.kr·네이버·스레드) 심의용 원고를 주제 선정부터 PAMS 접수 키트·ad_reviews 기록까지 한 흐름으로 진행할 때 사용"
---

# 선한금융 심의 원고 — 주제에서 접수까지

로버트는 **PAMS 업로드 + 자가점검 29항 + 네이버 비공개 게시 + 확인 배지**만 한다. 나머지는 관제탑(이 창)과 Claude Code(SHIN)가 한다. 한국어·존댓말, 명령 블록은 한 번에 하나.

## 0. 시작 전 반드시 조회 (말하기 전에)
- Supabase `lgbbflolunlseutvqaso`: `ad_reviews` 전건(심사중 수 = 슬롯), `premium_articles` 최근 발행 플래그
- 슬롯: [심사중] 3건 한도. 본진·네이버·스레드 모두 1건씩 차지. 1편(본진+네이버)=2건
- 정답지 = 최근 승인·초안 글 본문 1편(현재 6호 caregiver-daily-benefit-support-vs-use, 7호 ltc-grade-home-care-rider-check)
- 규격 정본: `D:\dev\SHIN\WRITING-SPEC.md` · 절차 `WORKFLOW-EVERGREEN-B.md` · 주제 `TOPIC-BANK.md` · 자료명 `configs/sources.json`

## 1. 주제·근거
- 수요: 지식iN API·TOPIC-BANK(블로그÷지식iN 비율 낮은 것). 근거: 공신력 기관 **원문 PDF**만(금감원·금융위·건보공단·복지부). 기사·블로그·재인용 불가. 발표 2년 이내
- 근거를 먼저 웹에서 찾아 존재를 확인한 뒤 CC 블록을 준다. 원문이 없으면 주제를 바꾸자고 먼저 말한다
- 보험 쪽 조건(특약 지급 조건·금액)을 원문 없이 단정하지 않는다 → 「약관에서 확인」까지만

## 2. CC(SHIN) 초안 블록에 넣을 것
- 근거 PDF를 실제 브라우저로 받아 `compliance\evidence\` 에 4요소 파일명(작성기관, 자료명, 기준년도, 발표일.pdf), sources.json 먼저 등록. 못 받으면 멈춤
- 본진·네이버 2벌, premium_articles 비공개 초안(발행 플래그 false), preflight 15/15
- 금지·필수: 고객 사례 금지(§2-2), 태도 한 줄, 「22년~25년 GA 명장」, 금액·보험료 금지(쓰면 산출기준 원 단위), 개인의견 귀속, 필수안내사항 brand.ts 자동, 심의필 줄 공란, verify_claims 전 항목 원문 쪽수, **심의 전 본진 링크 금지**
- 네이버 이미지는 config만 만들고 렌더 금지(관제탑 렌더). 브랜치 → PR → 푸시(머지는 관제탑 확인 후)

## 3. 관제탑 대조 (보고가 오면)
- 근거 PDF를 스테이징해 `pdftotext` 로 **본문 문장 하나하나 원문 대조**. 원문보다 센 표현(「A가 아니라」 vs 원문 「A만으로가 아니라」)은 DB에서 직접 고친다
- 🔴 **자료명은 원문 그대로 — 끝 기호(「 -」 등)까지.** 문서 자체 제목(표지·1쪽)이 정본, 게시판 공지 제목(「…안내」)은 아님. 8865호가 자료명 축약으로 반송됐다
- raw_source_url 채워졌는지, 본진·네이버에 옛 자구가 남지 않았는지 SQL로 확인
- 이미지: 관제탑 샌드박스(Noto CJK 폰트)에서 `naver_images.py <slug>` 렌더(scripts/ga_master.py·src/lib/brand.ts 함께 스테이징). 3장 이어붙여 눈으로 확인 — 칸 넘침·잘림이면 config 고쳐 재렌더 → `assets\naver\<slug>\` 와 config 를 기기에 커밋
- 그다음 CC 블록: PNG·config 커밋 → Storage `card-news/<slug>/naver-01~03.png` 업로드 + `naver_image_paths` → preflight → `gh pr merge --squash` → 접수 키트 생성

## 4. 접수 (로버트 몫 — 최소화)
- 어드민 확인 배지(B등급): **기계가 대신 체크할 수 없다**(진술 기록). 관제탑이 원문 대조를 끝냈다고 알리고 「전체 확인」 버튼만 누르게 한다
- 본진: CC `scripts/pams_kit.py <slug> main` → zip(웹 심의용 미리보기 PDF + 증빙 PDF + 게시명·자료명 txt)
- 네이버: 🔴 Claude in Chrome 은 네이버를 열 수 없다(안전 제한). 로버트가 어드민을 **새로고침한 뒤** [네이버 심의용 복사] → 붙여넣기 → 제목 칸 따로 입력 → 카테고리 「실손·보장성 가이드」 → 대표사진 1-thumb → **비공개** 발행 → 캡처. 한 줄 조언이 인용구 밖으로 빠지면 안으로 옮기게 안내. 그 캡처로 `pams_kit.py <slug> naver --capture` 
- 스레드 = **본문 + 본인 첫 댓글(본진 링크) 한 세트.** 필수안내사항·유의문구만 이미지. PAMS 「광고심의 신청 → 일반심의」, 광고형태 **스레드**, 게시명 `https://www.threads.com/@goodfinance_sj`. 소통형(끝은 질문), 금액 쓰지 않음, 본문 500자 이내
  - 본문은 `assets/threads/drafts/<slug>/body.txt`(LF 고정) → CC `scripts/pams_kit.py <slug> threads` → zip(접수 원고 txt + body/reply + 증빙). **PAMS 에는 「본문 + 빈 줄 + [첫 댓글] + 댓글」 한 덩어리를 붙여 넣는다** — 댓글 문구까지 심의 대상
  - 첫 댓글은 **본진이 approved·posted_url 있을 때만.** URL = 본진 URL + `?utm_source=threads&utm_campaign=<스레드 ad_reviews.id>`(이때만 스레드 draft 행을 만든다). 본진 심사중이면 댓글 없이 본문만(7550 방식). 문구 한두 줄, 상담 유인·단정·비교·「무료」 금지
  - 🔴 필수안내 이미지는 키트에 안 넣는다 — 7550 접수 때 심의필 줄을 어떻게 넣었는지 미확인. 확인 전 추측 금지
  - 접수 뒤: `pams_kit.py <slug> threads --submitted <zip>`(또는 10분 주기 pams_auto 가 submitted 감지 시 자동) → `card-news/threads/<ad_reviews.id>/body.txt·reply.txt` 업로드 + notes 에 「본문 <url> (sha256 …) · 댓글 <url> (sha256 …)」(robert-os 무인 게시가 이 꼴로 대조 — 형식 바꾸지 말 것). 승인 뒤 본문·댓글을 새로 만들지 않는다
  - 승인 후 게시는 robert-os `threads_auto`(게이트 7종) — 번호 넣은 필수안내 이미지는 그쪽이 `threads_notice.py` 로 만든다
- PAMS 게시명 = 실제 게시 제목 그대로. 특수문자 `' ? " &` 금지

## 5. 기록
- 접수 즉시 `ad_reviews` INSERT(channel·posting_title·ad_form·status='submitted'·notes에 증빙 자료명). 반송이면 즉시 `rejected` + 사유 원문. 승인이면 review_no·기간·posted_url
- 승인 후 공개 전환·PAMS 게시위치 등록, 본진 링크는 그때 넣는다

## 하지 말 것
- 원문 확인 전 결론 · 로버트에게 화면 확인 시키기 · 명령 블록 여러 개 · 이전 심의필 번호 재사용 · 확인 배지·자가점검 대리 체크 · 게시·PAMS 접수를 CC에 시키기