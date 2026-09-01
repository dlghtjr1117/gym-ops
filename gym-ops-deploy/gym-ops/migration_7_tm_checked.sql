-- 만료회원·TM 표에서 "내가 어디까지 확인했는지" 표시할 수 있도록 회원별 체크 표시 컬럼 추가
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table members add column if not exists tm_checked_at timestamptz;
