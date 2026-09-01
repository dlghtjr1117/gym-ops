-- OT 관리(OT1/OT2) 표의 "현황" 옆에 "예상 등록률"(25%/50%/75%) 칸을 추가하기 위한 컬럼.
-- 주차별 매출 기록의 재등록확률(stage/probability)과는 별개로, OT1/OT2 각각 독립적으로
-- 등록 가능성을 표시할 수 있도록 OT1용/OT2용 컬럼을 따로 둠 (ot_date/ot_status, ot2_date/ot2_status와 같은 구조)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table pt_leads add column if not exists ot_expected_probability numeric;
alter table pt_leads add column if not exists ot2_expected_probability numeric;
