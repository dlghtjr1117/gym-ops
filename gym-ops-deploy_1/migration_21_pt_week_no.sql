-- 주차별 매출 기록에서 "주차"를 상담일로부터 자동 계산하지 않고
-- 직접 선택(1주차~5주차)할 수 있게 하기 위해 추가
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table pt_leads add column if not exists week_no int check (week_no between 1 and 5);
