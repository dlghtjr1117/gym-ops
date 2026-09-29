-- 회원 주소 / 특이사항 메모 필드 추가
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table members add column if not exists address text;
alter table members add column if not exists memo text;   -- 특이사항 등을 자유롭게 적어두는 메모칸
