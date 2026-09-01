-- 결제수단에 "키오스크"(무인 결제기) 추가
-- 센터에 키오스크가 있어서, 카드/현금/계좌이체 말고 키오스크로 결제된 매출도 따로 구분해서 집계하기 위함
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table sales drop constraint if exists sales_payment_method_check;
alter table sales add constraint sales_payment_method_check
  check (payment_method in ('card', 'cash', 'transfer', 'kiosk'));
