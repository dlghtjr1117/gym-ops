-- 매출(sales)에 결제수단(카드/현금/계좌이체) 컬럼 추가
-- 담당자(staff_id)는 이미 있던 컬럼을 그대로 씁니다 (화면에서 직접 고를 수 있게 select만 추가됨) -> 이 마이그레이션은 필요 없음, payment_method만 추가하면 됨
alter table sales add column if not exists payment_method text check (payment_method in ('card', 'cash', 'transfer'));
