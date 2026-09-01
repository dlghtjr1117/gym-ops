-- 매출 항목에 그룹PT/락커/운동복 추가 (회원 등록 -> 매출/TM 자동 연동 기능에 필요)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table sales drop constraint if exists sales_category_check;
alter table sales add constraint sales_category_check
  check (category in ('membership_new','membership_renewal','pt_new','pt_renewal','group_pt_new','group_pt_renewal','locker','clothes'));
