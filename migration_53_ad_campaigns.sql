-- Supabase SQL Editor에서 새 쿼리로 실행해주세요
-- 광고 성과 관리(marketing.html) - 당근/인스타그램/페이스북 캠페인별로 일별 지출·관심·쿠폰다운로드·
-- 실제유입을 기록해서 어떤 광고가 효율적인지 비교하기 위한 테이블 2개(캠페인 + 캠페인별 일별 기록)

create table ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('carrot', 'instagram', 'facebook')),
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table ad_campaign_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references ad_campaigns(id) on delete cascade,
  log_date date not null,
  spend numeric,
  interest_count integer,
  coupon_count integer,
  actual_count integer,
  memo text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table ad_campaigns enable row level security;
alter table ad_campaign_logs enable row level security;

-- 전체 직원 공용: 담당자 구분 없이 모두가 조회/등록/수정/삭제 가능 (신규상담과 같은 패턴)
create policy "광고 캠페인 조회" on ad_campaigns
  for select using (auth.uid() is not null);
create policy "광고 캠페인 등록" on ad_campaigns
  for insert with check (auth.uid() is not null);
create policy "광고 캠페인 수정" on ad_campaigns
  for update using (auth.uid() is not null);
create policy "광고 캠페인 삭제" on ad_campaigns
  for delete using (auth.uid() is not null);

create policy "광고 일별기록 조회" on ad_campaign_logs
  for select using (auth.uid() is not null);
create policy "광고 일별기록 등록" on ad_campaign_logs
  for insert with check (auth.uid() is not null);
create policy "광고 일별기록 수정" on ad_campaign_logs
  for update using (auth.uid() is not null);
create policy "광고 일별기록 삭제" on ad_campaign_logs
  for delete using (auth.uid() is not null);

create index ad_campaigns_platform_idx on ad_campaigns (platform);
create index ad_campaign_logs_campaign_idx on ad_campaign_logs (campaign_id);
create index ad_campaign_logs_date_idx on ad_campaign_logs (log_date desc);
