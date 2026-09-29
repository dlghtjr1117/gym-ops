-- 만료회원·TM 페이지에서 TM 상태를 바꿀 때, 어떤 상품(헬스이용권/그룹PT/개인PT/락커/운동복)에
-- 대한 기록인지 같이 저장해서 대시보드의 "상품별(FC/PT) 재등록 현황"을 정확히 계산할 수 있게 함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table tm_logs add column if not exists category text;
