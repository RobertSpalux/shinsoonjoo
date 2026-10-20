-- 010 — premium_articles.main_keyword 초기값(IX1 2026-10-20). 009 적용 뒤에 선택 적용.
-- ⚠️ 아직 적용하지 않았다. 관제탑이 SHIN DB(lgbbflolunlseutvqaso)에 적용.
-- 값 = 관제탑 10/20 첫 측정(relay/work/2026-10-20/idx/naver_kw.py)의 「실제 검색어」. 비어 있는 칸만 채운다(사람이 고친 값은 덮지 않음).
-- 여기 없는 글(제왕절개 280일 등)은 비워 두면 측정 스크립트가 제목 앞 3어절(auto)로 잰다 — 어드민 표에 「auto」로 보인다.

update public.premium_articles p set main_keyword = v.kw
from (values
  ('silson-duplicate-proportional-compensation', '실손 중복 가입'),
  ('noncovered-injection-silson-treatment-purpose', '비급여 주사 실비'),
  ('annuity-insurance-cancel-tax-keep-options', '연금보험 해지 세금'),
  ('whole-life-cancel-refund-keep-options', '종신보험 해지 환급금'),
  ('daily-liability-nusu-own-home-tenant-landlord', '일배책 누수'),
  ('silson-claim-deadline-3year-start-point', '실비 청구 기간'),
  ('overseas-stay-3month-silson-premium-refund', '해외 체류 실손 환급'),
  ('ltc-grade-home-care-rider-check', '장기요양등급 방문요양'),
  ('cataract-surgery-silson-inpatient-or-outpatient', '백내장 실비 통원'),
  ('caregiver-daily-benefit-support-vs-use', '간병비보험 청구 서류'),
  ('exclusion-release-5year-treatment-record', '부담보 해제'),
  ('group-personal-silson-suspend-resume', '퇴사 실손 재개'),
  ('silson-conversion-withdrawal-6month', '실손 갈아타기 철회'),
  ('health-checkup-retest-disclosure-scope', '추적관찰 보험 가입'),
  ('insurance-remodeling-self-checklist-7', '보험 리모델링'),
  ('pre-existing-condition-disclosure-exclusion-guide', '갑상선 결절 보험 가입'),
  ('daily-life-liability-deductible-nusu', '일상생활배상책임 누수 전세')
) as v(slug, kw)
where p.slug = v.slug and p.main_keyword is null;

-- 무릎 줄기세포 글은 slug 가 길어 접두로 맞춘다
update public.premium_articles set main_keyword = '무릎 줄기세포 주사 실비'
where slug like 'knee-injection-neuroplasty-surgery-definition%' and main_keyword is null;
