# 분석 프로그램(soonjoo_AI) — 저장 시 자동 로컬 백업 · 구현 설계서

> 작성 2026-09-30 (관제탑 0930-1100 지시 3). **설계만 — 코드 변경 없음.**
> 대상: `D:\dev\Soonjoo_AI\soonjoo_AI.html`(단일 HTML, git 아님).
> 근거: 같은 폴더 `HANDOFF.md`·`CLAUDE.md`와 코드 구조(함수 이름·줄 번호). **고객 데이터 파일(`_dump_*`, 백업 JSON)은 열지 않았다.**
> 🔴 원칙: 고객 실데이터는 **이 PC 밖으로 나가지 않는다**(CLAUDE.md §2 사업 구조 6 · §6.1). 네트워크·클라우드 전송이 없는 설계만 한다.

---

## 0. 왜 이것이 1순위인가 (선정 정정 포함)

- 10:45 보고에서 1순위로 올린 「미분류 매핑을 누적 저장해 다음 고객부터 자동 적용」은 **이미 구현돼 있다.**
  - 학습형 매핑 사전: HANDOFF 확정결정 6, 161행 — 「지정」으로 한 번 확정하면 영구 학습된다.
  - 자동 제안 `suggestStdForMisc`: HANDOFF 59행.
  - 조사 요약이 이 부분을 놓쳤다. **정정한다.** 남은 매핑 수작업은 「처음 보는 보험사·특약」뿐이고, 자동 확정 0건은 의도된 안전장치다(확정결정 12).
- 그래서 1순위는 **2위였던 자동 백업**으로 바꾼다. 이유:
  1. **실제 데이터 손실 사고가 1회 있었다**(HANDOFF 148행 「데이터 손실 사고 1회 발생·수정 완료(activeId 가드)」).
  2. 데이터는 IndexedDB 한 곳에만 있다(기기·브라우저 로컬). 브라우저 데이터 삭제·프로필 손상·PC 교체 한 번이면 **전 고객·매핑 사전이 사라진다.**
  3. 지금 복구 수단은 사람이 누르는 [💾 전체 백업(JSON)]뿐이다. 리마인더 배지는 있지만 누르지 않으면 소용없다.
  4. **아내 PC 이전이 대기 중**이다(HANDOFF 「다음 할 일」 2). 이전 전에 백업 경로가 자동이어야 한다.
  5. 효과는 상(사업 자산 보호), 난이도는 하~중(기존 백업 코드를 재사용하고 저장 경로 하나에만 연결).

## 1. 지금 구조 (코드 기준)

| 기능 | 함수(줄) | 비고 |
|---|---|---|
| 고객 저장 | `saveCustomer()` (2642) | 버튼 클릭 → 덮어쓰기 가드 → `idbPut(rec)` → `refreshBackupBadge()` |
| 백업 데이터 모으기 | `gatherBackup()` (2484) | IDB 전체 고객 + 매핑 사전 → `buildBackup()` |
| 백업 형식 | `buildBackup()` (2416) / `validateBackup()` (2422) | `{app:"soonjoo_AI", backupVersion:1, schema, exportedAt, customers[], mappings[]}` |
| 수동 내보내기 | `exportBackup()` (2491) | Blob → `<a download>` → 다운로드 폴더. `setLastBackupAt()` |
| 가져오기 | `importBackup()` (2503) / `mergeBackup()` (2430) | 합치기/교체, 스키마 이행 포함 |
| 리마인더 | `backupStatus()` (2456) · `refreshBackupBadge()` (2471) | 「미백업 변경」 판정 — 경과일수가 아니라 `lastBackupAt < maxUpdatedAt` |
| 저장소 | `indexedDB.open(IDB_NAME, IDB_VER)` (2202) | store: `IDB_STORE`(고객, keyPath id) · `IDB_MAP`(매핑, keyPath insurer) |

→ **백업 형식·검증·복원은 이미 완성돼 있다. 빠진 것은 「저장할 때 자동으로 파일에 쓰는 것」 하나다.**

## 2. 설계

### 2-1. 동작 개요
1. **최초 1회 설정** — 툴바 [📁 자동 백업 폴더 지정] → `showDirectoryPicker({mode:"readwrite"})` → 폴더 핸들을 IndexedDB 에 저장한다.
2. **[💾 고객 저장] 성공 직후** — `idbPut` 이 끝나면 `autoBackup()`:
   1. 폴더 권한 확인(`queryPermission`). `prompt` 이면 `requestPermission` — **저장 버튼 클릭이 사용자 제스처라 크롬이 허용한다.**
   2. `gatherBackup()` 결과를 `soonjoo_AI_auto_YYYY-MM-DD_HHMMSS.json` 으로 쓴다(`createWritable` → `write` → `close`. `close` 시점에 원자적으로 교체된다).
   3. **다시 읽어 검증**: 파일을 열어 `JSON.parse` → `validateBackup` → 고객 수·매핑 수가 방금 모은 값과 같은지 본다.
   4. 성공이면 `setLastBackupAt()` + `refreshBackupBadge()` → 배지 ⚪, 토스트 「자동 백업됨(고객 N · 매핑 M)」.
   5. 보관 정리(2-3).
3. **실패해도 저장은 이미 끝난 상태다.** 백업 실패는 토스트 🔴 「자동 백업 실패 — [💾 전체 백업]을 눌러 주세요」로 알리고 배지를 🟠 로 둔다. 저장 결과를 되돌리지 않는다.

### 2-2. 폴더 핸들 저장
- `FileSystemDirectoryHandle` 은 구조화 복제가 되므로 IndexedDB 에 그대로 넣을 수 있다.
- **방법 A(권장)**: 새 object store `IDB_SETTINGS`(keyPath `key`)를 추가한다. `IDB_VER` +1, `onupgradeneeded` 에서 `if (!db.objectStoreNames.contains(...)) createObjectStore(...)` — 기존 두 store 는 건드리지 않는다.
- 방법 B(버전 올리기를 피할 때): localStorage 에는 핸들을 못 넣는다. 그래서 A 가 유일한 정석이다. 버전을 올리는 이행은 **`migCovChain` 과 무관**하다(스키마 4 불변).
- 설정 화면에 「현재 폴더: <폴더 이름>」을 보여 준다. API 는 전체 경로를 주지 않는다.

### 2-3. 보관 정책 (세대 관리)
- 보관: **최근 30개 + 날짜별 첫 파일은 90일**. 나머지 `soonjoo_AI_auto_*.json` 만 `removeEntry` 로 지운다.
- 🔴 이 접두어 파일만 지운다. 수동 백업(`soonjoo_AI_backup_*`)이나 다른 파일은 절대 건드리지 않는다.
- 순수 함수 `planRotation(fileNames, now) → {keep[], remove[]}` 로 분리한다(vm 테스트 대상).

### 2-4. 파일명 · 순수 함수
- `autoBackupName(date) → "soonjoo_AI_auto_2026-09-30_143015.json"` (순수, 로컬 시각, 초 단위 — 같은 초 재저장은 덮어써도 내용이 같다)
- `planRotation(names, now)` (순수)
- `verifyBackupText(text, expect) → {ok, reason}` (순수: parse + validateBackup + 개수 대조)
- DOM·파일 API 를 만지는 부분은 `autoBackup()` 하나에만 둔다(기존 코드처럼 「순수 판정 + 얇은 부작용」 구조).

### 2-5. 브라우저 지원 · 대체 경로
- File System Access API 는 **크롬·엣지(데스크톱)** 전용이다. 신순주 PC 가 크롬이라는 전제는 HANDOFF 「크롬 육안 점검」과 같다.
- `window.showDirectoryPicker` 가 없거나, 권한이 거부되거나, 폴더가 사라지면:
  - 자동 백업을 끄고 배지에 「자동 백업 꺼짐 — 폴더를 다시 지정하거나 [💾 전체 백업]」을 띄운다.
  - **조용히 실패하지 않는다.**

### 2-6. 개인정보 · 보안
- 네트워크 전송 0. `fetch`·외부 스크립트 추가 없음.
- ⚠️ **클라우드 동기화 폴더 경고**: 사용자가 OneDrive·Google Drive·Dropbox 동기화 폴더(윈도 「문서」가 OneDrive 로 연결된 경우 포함)를 고르면 고객 실데이터가 클라우드로 올라간다.
  - API 로는 경로를 알 수 없다. 그래서 **폴더 지정 화면에 고정 경고문을 띄우고, 권장 경로(`D:\soonjoo_backup` 같은 로컬 전용 폴더)를 안내**한다.
  - 폴더 이름에 `OneDrive|Google Drive|Dropbox|iCloud` 가 보이면 확인창을 한 번 더 띄운다.
- 백업 파일에는 주민번호가 없다(프로그램이 받지 않음). 다만 이름·계약 정보가 있으므로 PC 잠금·폴더 권한은 운영 수칙으로 둔다.

## 3. 시험 계획 (기존 `node tests/*.js` vm 방식)
| 시험 | 내용 |
|---|---|
| `test_auto_backup_name` | 날짜 → 파일명 형식, 0 채움, 로컬 시각 |
| `test_auto_backup_rotation` | 45개 목록 → 최근 30 + 날짜별 첫 파일(90일) 유지. `soonjoo_AI_backup_*`·기타 파일은 remove 에 절대 없음. 경계(정확히 30개, 90일째) |
| `test_auto_backup_verify` | 정상 / 깨진 JSON / app 다름 / 고객 수 불일치 → ok=false |
| `test_auto_backup_flow` | 모의 디렉터리 핸들(메모리): 저장 → 파일 1개 생성 → 검증 통과 → `lastBackupAt` 갱신. 쓰기 예외 시 IDB 저장은 유지되고 배지는 stale |
| 회귀 | 기존 16종 전부 — `saveCustomer` 의 덮어쓰기 가드·`idbPut` 경로가 글자 단위로 불변인지 확인(`test_save_guard` 34 포함) |
- 크롬 육안(수동, 1회):
  1. 폴더 지정 → 저장 3회 → 파일 3개 생성 확인
  2. 브라우저 재시작 후 저장 → 권한 재요청 1회 → 통과
  3. **자동 백업 파일로 「📂 백업 가져오기 — 교체」 왕복 → 고객·매핑 수 일치**(아내 PC 이전 리허설을 겸한다)

## 4. 작업 순서 · 추정
1. 순수 함수 3개 + 시험 3종 (반나절)
2. `IDB_SETTINGS` store 추가 + 폴더 지정 UI + 경고문 (반나절)
3. `saveCustomer` 성공 분기 끝에 `await autoBackup()` 한 줄 연결 + 실패 토스트 (1~2시간)
4. 회귀 16종 + 크롬 육안 + 백업 왕복 E2E (반나절)
5. HANDOFF 에 확정결정 추가: 「자동 백업은 저장 성공 뒤에만, 실패가 저장을 되돌리지 않는다, `soonjoo_AI_auto_*` 만 정리한다」
- 합계 약 1.5~2일. **아내 PC 이전 전에 끝내는 것을 권장**한다(이전 절차가 「폴더 지정 1회 + 자동 백업 파일 가져오기」로 단순해진다).

## 5. 하지 않는 것
- 클라우드·서버 백업, 암호화 업로드, 다른 기기 자동 동기화 — 실데이터 외부 반출이라 범위 밖이다(§6.1).
- 매핑 자동 확정 — 확정결정 12 유지.
- 기존 수동 [💾 전체 백업] 버튼 제거 — 유지한다. 자동이 꺼진 환경의 유일한 경로다.
