-- 대시보드 "문의 경로" 섹션 아래 남는 빈 공간에 추가하는 일별 포대수(전단지 배포 개수) 기록표.
-- 날짜 하나에 숫자 하나만 있으면 되는 아주 단순한 공용 집계라 marketing_inquiries(채널까지 나뉨)보다 구조가 단순함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table flyer_counts (
  id uuid primary key default gen_random_uuid(),
  record_date date not null unique,
  count integer not null default 0 check (count >= 0),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

alter table flyer_counts enable row level security;

-- 문의 경로/워크인과 같은 방식 - 지점장뿐 아니라 트레이너도 그때그때 바로 기록할 수 있게 공용으로 열어둠
create policy "포대수 조회" on flyer_counts for select using (auth.uid() is not null);
create policy "포대수 기록" on flyer_counts for insert with check (auth.uid() is not null);
create policy "포대수 수정" on flyer_counts for update using (auth.uid() is not null);

create index if not exists flyer_counts_date_idx on flyer_counts (record_date);
