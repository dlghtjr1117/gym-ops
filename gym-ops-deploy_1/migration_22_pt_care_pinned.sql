-- PT 회원 관리 시트에 "잔여횟수가 적어서 자동으로 뜬 회원" 말고
-- 트레이너/지점장이 직접 골라서 추가한 회원도 표시하기 위해 추가
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table members add column if not exists pt_care_pinned boolean not null default false;
