-- TM 상태에 "재등록 예정" 추가 (재등록/이월/고민중은 기존 값 재사용, 라벨만 새로 바뀜)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table tm_logs drop constraint if exists tm_logs_status_check;
alter table tm_logs add constraint tm_logs_status_check
  check (status in ('not_contacted','in_progress','renewed','rolled_over','declined','re_registration_planned'));
