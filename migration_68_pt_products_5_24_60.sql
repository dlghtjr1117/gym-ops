-- 1~8월 과거 PT 매출(바디코디 판매내역) 가져오기 작업 중, 기존 상품 카탈로그(10/20/30/50/100회)에
-- 없는 회차의 실제 판매 건이 발견되어 PT 상품 3종을 추가함.
--   - 초심자패키지 5회 / 200,000원 (정주민, 정미란 1월 건)
--   - 개인PT 24회 / 1,428,000원 (엄남훈 3월 건)
--   - 개인PT 60회 / 2,901,000원 (이재완 4월 건)
-- seed_products.sql과 동일한 방식으로 추가. 이미 존재하면 중복 추가되지 않도록
-- (category='pt' and sessions=N) 존재 여부를 확인하고 없을 때만 insert함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요.

insert into products (name, category, price, duration_days, sessions, active)
select '초심자패키지 5회', 'pt', 200000, null, 5, true
where not exists (select 1 from products where category = 'pt' and sessions = 5);

insert into products (name, category, price, duration_days, sessions, active)
select '개인PT 24회', 'pt', 1428000, null, 24, true
where not exists (select 1 from products where category = 'pt' and sessions = 24);

insert into products (name, category, price, duration_days, sessions, active)
select '개인PT 60회', 'pt', 2901000, null, 60, true
where not exists (select 1 from products where category = 'pt' and sessions = 60);
