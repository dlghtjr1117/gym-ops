-- 계정 관리 화면(accounts.html): 센터에서 같이 쓰는 네이버/네이버플레이스/노션/구글 등
-- 서비스 계정(아이디/비밀번호)을 한 곳에 모아두는 표. 문의 경로/워크인처럼 이름 없이
-- 센터 전체가 공용으로 보고 쓰는 데이터라 trainer_id가 없고, 로그인한 직원이면 누구나
-- 조회·등록·수정·삭제할 수 있게 함(호석님이 "센터 전체 직원 공용"으로 선택).
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table service_accounts (
  id uuid primary key default gen_random_uuid(),
  service_name text not null,
  login_id text,
  password text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table service_accounts enable row level security;

create policy "계정 정보 조회" on service_accounts for select using (auth.uid() is not null);
create policy "계정 정보 등록" on service_accounts for insert with check (auth.uid() is not null);
create policy "계정 정보 수정" on service_accounts for update using (auth.uid() is not null);
create policy "계정 정보 삭제" on service_accounts for delete using (auth.uid() is not null);

create index if not exists service_accounts_name_idx on service_accounts (service_name);
