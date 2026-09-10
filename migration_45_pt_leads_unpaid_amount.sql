-- PT 관리("상담·매출 기록 추가") 주차별 매출 기록 표에 "미납금" 칸을 추가하기 위한 변경.
-- 회원 관리의 "미수금"(분할 결제 관리, receivables 테이블)과는 별개의 가벼운 메모용 숫자 칸임 -
-- 아직 실제 회원으로 등록되기 전(상담 단계)인 기록도 많아서, member_id가 꼭 있어야 하는 receivables
-- 테이블에 넣기보다는 pt_leads에 숫자 칸 하나만 추가해서 트레이너가 바로바로 적어둘 수 있게 함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요.

alter table pt_leads add column if not exists unpaid_amount numeric;
