-- 만료회원 · TM 화면에 "1차 / 2차 / 3차 연락일" 칸 추가 (2026-10-06)
-- 회원 한 명당 연락한 날짜를 최대 3번까지 적어두는 칸이에요(TM 상태와 별개로 "언제 연락했는지"만 기록).
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. 여러 번 실행해도 안전해요.
alter table members add column if not exists tm_contact1_date date;
alter table members add column if not exists tm_contact2_date date;
alter table members add column if not exists tm_contact3_date date;

notify pgrst, 'reload schema';
