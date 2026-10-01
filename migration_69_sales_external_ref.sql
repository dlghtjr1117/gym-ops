-- 바디코디 판매내역 엑셀 업로드 기능(sales.html) 추가를 위해 필요한 컬럼.
--
-- (2026-10-01 수정) 처음에는 "같은 판매번호가 두 번 들어오면 바디코디 파일끼리 겹친 중복"이라고
-- 생각해서 판매번호 하나당 1건만 허용하는 유니크 제약으로 만들었었는데, 1~8월 과거 데이터를 실제로
-- 들여다보니 그게 아니었음 - 바디코디는 "계약금 + 잔금"처럼 할부로 나눠 결제하면, 같은 판매번호로
-- 결제할 때마다(그 금액만큼) 새 행을 하나씩 추가함(예: 1월에 100만원, 2월에 155만원을 같은
-- 판매번호로 따로 결제). 즉 판매번호가 같아도 날짜·금액이 다르면 전부 실제로 돈이 들어온 별개의
-- 결제 건임 - 판매번호만으로 유니크하게 막으면 할부 잔금 결제가 통째로 막혀서 매출이 실제보다 적게
-- 잡힘. 그래서 유니크 제약은 "판매번호+판매일자(sale_date)+금액(amount)"이 전부 같을 때만(=같은
-- 엑셀을 실수로 두 번 올렸을 때) 막도록 좁힘 - 기존에 이미 있는 sale_date/amount 컬럼을 그대로 쓰면
-- 되므로 별도 타임스탬프 컬럼은 따로 안 둠. 직접 입력한 매출(엑셀 업로드가 아닌 건)은
-- external_sale_no가 비어있는 게 정상이라 null은 허용함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요 (이미 migration_69를 예전 버전으로 실행했다면, 이
-- 파일을 다시 실행하면 옛 유니크 인덱스/컬럼을 정리하고 새 걸로 바꿔줌)

alter table sales add column if not exists external_sale_no text;
alter table sales drop column if exists external_paid_at;

drop index if exists sales_external_sale_no_uidx;
drop index if exists sales_external_sale_uidx;

create unique index if not exists sales_external_sale_uidx2
  on sales(external_sale_no, sale_date, amount)
  where external_sale_no is not null;
