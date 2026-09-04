-- 미수금(분할 결제) 관리: "PT 30회 정상가로 등록하고, 오늘은 계약금만 받고 잔금은 다음에 받기"처럼
-- 결제를 나눠서 받는 경우를 위한 테이블. 정식 매출(sales)은 항상 "그날 실제로 받은 금액"만 남기고,
-- 아직 못 받은 나머지 금액만 이 테이블에 따로 기록해뒀다가, 나중에 잔금을 받으면 그 시점에
-- 새 매출을 하나 더 만들고 이 테이블의 paid_amount를 올려서 다 받으면 자동으로 완결 처리함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요.

create table receivables (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  item_name text not null,                 -- 상품명 스냅샷(나중에 상품명이 바뀌어도 안 흔들리게)
  category text,                            -- 매출 카테고리(예: pt_new) - 잔금 받을 때 새 매출에도 그대로 씀
  product_id uuid references products(id),
  total_amount numeric not null,            -- 정상가 / 계약 총액
  paid_amount numeric not null default 0,   -- 지금까지 실제로 받은 금액(최초 계약금 포함, 잔금 받을 때마다 누적)
  status text not null default 'open' check (status in ('open', 'settled')),
  original_sale_id uuid references sales(id) on delete set null, -- 최초 계약금 매출 건과 연결(계약금이 0원이면 null)
  staff_id uuid references profiles(id),    -- 등록 담당자
  created_at timestamptz default now(),
  settled_at timestamptz
);

alter table receivables enable row level security;

-- 조회/등록/수정: 로그인한 직원이면 누구나 (매출 입력과 동일한 권한 수준)
create policy "미수금 조회" on receivables for select using (auth.uid() is not null);
create policy "미수금 등록" on receivables for insert with check (auth.uid() is not null);
create policy "미수금 수정" on receivables for update using (auth.uid() is not null);
-- 삭제(잘못 등록한 미수금 건 제거)는 지점장만
create policy "미수금 삭제" on receivables for delete using (is_manager());

create index if not exists receivables_member_id_idx on receivables(member_id);
create index if not exists receivables_status_idx on receivables(status);
