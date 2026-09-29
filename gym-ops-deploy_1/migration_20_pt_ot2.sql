-- OT 관리를 OT1(최초 체험)/OT2(2차 팔로우업) 두 트랙으로 나눠서 관리하기 위해 추가
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table pt_leads add column if not exists ot2_date date;             -- 2차 OT 예정/진행일
alter table pt_leads add column if not exists ot2_status text            -- 2차 OT 진행 상황
  check (ot2_status in ('scheduled','rolled_over','missed','done'));
