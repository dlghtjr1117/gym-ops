-- Supabase SQL Editor에서 새 쿼리로 실행해주세요
-- 워크인/전화상담(신규상담) 관리 시트를 위한 테이블
-- 기존 marketing_inquiries / workin_results 테이블은 날짜별 집계 카운터라
-- 개인별 상담 기록(이름, 연락처 등)을 저장할 수 없어서 새 테이블을 만듭니다.

create table walkin_consultations (
  id uuid primary key default gen_random_uuid(),
  consult_date date not null,
  name text not null,
  phone text,
  gender text check (gender in ('male', 'female')),
  channel text check (channel in (
    'naver_place', 'carrot', 'blog', 'referral',
    'instagram', 'meta_ads', 'flyer', 'walk_by'
  )),
  interest_gym boolean not null default false,
  interest_pt boolean not null default false,
  interest_group_pt boolean not null default false,
  memo text,
  status text not null default 'considering' check (
    status in ('considering', 'rolled_over', 'declined', 'registered')
  ),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table walkin_consultations enable row level security;

-- 전체 직원 공용 리스트: 담당자 구분 없이 모두가 조회/등록/수정/삭제 가능
create policy "신규상담 조회" on walkin_consultations
  for select using (auth.uid() is not null);

create policy "신규상담 등록" on walkin_consultations
  for insert with check (auth.uid() is not null);

create policy "신규상담 수정" on walkin_consultations
  for update using (auth.uid() is not null);

create policy "신규상담 삭제" on walkin_consultations
  for delete using (auth.uid() is not null);

create index walkin_consultations_date_idx on walkin_consultations (consult_date desc);
create index walkin_consultations_status_idx on walkin_consultations (status);
