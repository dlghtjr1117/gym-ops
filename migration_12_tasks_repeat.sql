-- 업무 리스트에 반복(매일/매주) 기능 추가 - 마이크로소프트 투두처럼
-- 체크한 반복 업무가 다음 주기(다음 날/다음 주)에 자동으로 다시 미체크 상태로 보이게 함
-- (이전에 청소 체크리스트용으로 드렸던 migration_11_checklist_items.sql은 이제 필요 없어요,
--  실행 안 하셨다면 건너뛰셔도 됩니다)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table tasks add column if not exists repeat_type text not null default 'none'
  check (repeat_type in ('none','daily','weekly'));
alter table tasks add column if not exists repeat_weekday int check (repeat_weekday between 0 and 6); -- 0=일,1=월,...6=토
alter table tasks add column if not exists last_completed_at timestamptz;
