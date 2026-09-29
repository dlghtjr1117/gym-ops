-- TM 상태에 "부재중"(전화했는데 안 받음) 추가
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table tm_logs drop constraint if exists tm_logs_status_check;
alter table tm_logs add constraint tm_logs_status_check
  check (status in ('not_contacted','in_progress','renewed','rolled_over','declined','re_registration_planned','no_answer'));
