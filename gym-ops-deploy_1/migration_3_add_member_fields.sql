-- 회원 항목 확장: 그룹PT / 락커 / 운동복
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table members add column if not exists group_pt_type text;
alter table members add column if not exists group_pt_end_date date;
alter table members add column if not exists locker_end_date date;
alter table members add column if not exists workout_clothes_end_date date;
