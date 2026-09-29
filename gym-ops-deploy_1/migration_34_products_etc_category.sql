-- 이용권(상품) 관리에 "기타" 카테고리 추가 + 그 안에 "양도비"(30,000원) 상품 등록
-- (지금까지 상품 카테고리는 헬스이용권/그룹PT/개인PT/락커/운동복 5개뿐이었는데,
--  회원 만료일과 연결되지 않는 1회성 상품(양도비 등)을 담을 곳이 없어서 "기타"를 새로 추가함)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

-- 1) products.category에 'etc' 허용
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('membership','group_pt','pt','locker','clothes','etc'));

-- 2) sales.category에도 'etc' 허용 (기타 상품을 팔면 매출 항목도 "기타"로 기록됨)
alter table sales drop constraint if exists sales_category_check;
alter table sales add constraint sales_category_check
  check (category in ('membership_new','membership_renewal','pt_new','pt_renewal','group_pt_new','group_pt_renewal','locker','clothes','day_pass','membership_transfer','uncategorized','etc'));

-- 3) "양도비" 상품 등록 (30,000원, 기간/횟수 없음 - 1회성 결제 상품)
insert into products (name, category, price, active)
values ('양도비', 'etc', 30000, true);
