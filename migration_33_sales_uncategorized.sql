-- 판매내역(POS) 엑셀 일괄 가져오기 기능을 위해 추가.
-- 실제 POS 내보내기 파일에는 "헬스이용권 12개월 외 2건"처럼 여러 상품이 한 번에 묶여 결제된 행이 있는데,
-- 이런 행은 항목별 금액이 안 쪼개져 있어서 기존 카테고리(회원권/PT/그룹PT/락커/운동복 등) 중 하나로
-- 자신있게 분류할 수가 없음. 그렇다고 건너뛰면 매출 총액이 실제보다 적게 잡히니까,
-- 일단 "미분류(확인필요)"로 전부 등록해두고 나중에 매출 입력 화면에서 담당자가 직접 항목별로 재분류하도록 함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table sales drop constraint if exists sales_category_check;
alter table sales add constraint sales_category_check
  check (category in ('membership_new','membership_renewal','pt_new','pt_renewal','group_pt_new','group_pt_renewal','locker','clothes','day_pass','membership_transfer','uncategorized'));
