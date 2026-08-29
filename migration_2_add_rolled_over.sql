-- 이미 schema.sql을 실행하신 분들을 위한 추가 변경사항
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

-- tm_logs 상태값에 '이월'(rolled_over) 추가
alter table tm_logs drop constraint if exists tm_logs_status_check;
alter table tm_logs add constraint tm_logs_status_check
  check (status in ('not_contacted','in_progress','renewed','rolled_over','declined'));
