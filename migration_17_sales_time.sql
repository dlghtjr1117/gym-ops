-- 매출에 "판매 시각"(몇 시 몇 분) 기록 추가
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요
--
-- sale_date(날짜)는 기존 그대로 두고, 시:분만 별도 컬럼으로 추가함
-- (날짜 범위로 매출을 조회하는 기존 코드들이 sale_date를 그대로 쓰고 있어서
--  날짜 컬럼 자체를 바꾸면 전부 깨지기 때문에, 건드리지 않고 컬럼만 추가하는 방식으로 함)

alter table sales add column if not exists sale_time time;
