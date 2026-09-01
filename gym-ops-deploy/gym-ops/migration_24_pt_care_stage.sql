-- PT 회원 관리의 "재등록확률"에서 100%를 없애고 "등록"으로 합치고, "이월" 단계도 추가하기 위해
-- 주차별 매출 기록(pt_leads.stage)과 같은 방식의 단계 컬럼을 pt_care_logs에도 추가
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table pt_care_logs add column if not exists renewal_stage text not null default 'in_progress'
  check (renewal_stage in ('in_progress','registered','rolled_over','missed'));
