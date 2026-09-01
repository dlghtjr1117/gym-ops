-- 이용권(상품) 관리: 지금까지 자유 텍스트로 입력하던 이용권 종목을 정해진 상품 목록으로 관리
-- (오타/표기 차이로 인한 통계 오류를 막고, 매출 입력·회원 등록 시 가격/기간을 자동으로 채워줌)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- 상품명, 예: "헬스 3개월권", "올바른 운동 그룹PT 10회"
  category text not null check (category in ('membership','group_pt','pt','locker','clothes')),
  price numeric,                      -- 기본 가격 (매출 입력 시 자동으로 채워지고, 필요하면 그때그때 수정 가능)
  duration_days int,                  -- 기간제 상품의 유효기간(일). 등록/재등록 시 "오늘 + 이 기간"으로 만료일 자동 계산
  sessions int,                       -- 회차제 상품(개인PT 등)의 횟수
  active boolean not null default true, -- 더 이상 안 파는 상품은 비활성화만 하고 삭제는 안 함 (과거 매출 기록 보존)
  created_at timestamptz default now()
);

alter table products enable row level security;

-- 조회: 로그인한 직원이면 누구나 (매출 입력, 회원 등록 화면에서 다 같이 씀)
create policy "상품 조회" on products for select using (auth.uid() is not null);
-- 등록/수정/삭제: 지점장만
create policy "상품 등록" on products for insert with check (is_manager());
create policy "상품 수정" on products for update using (is_manager());
create policy "상품 삭제" on products for delete using (is_manager());

-- 매출 기록에 어떤 상품을 판매한 건지 남길 수 있도록 (선택 항목 - 상품 없이 직접 입력도 계속 가능)
alter table sales add column if not exists product_id uuid references products(id);
