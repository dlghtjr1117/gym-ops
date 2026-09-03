-- 상담 워크인 / 미스 표(대시보드 "상담 워크인 / 미스" 섹션): 원래 엑셀 시트에서 주차별로 적던
-- "그날 상담이 성공했는지 실패(미스)했는지" 집계를 앱으로 옮긴 것. 문의 경로처럼 이름 없이 그날짜의
-- 성공/실패 건수만 세는 방식이고, 트레이너 개인 기록이 아니라 센터 전체가 같이 보는 공용 집계라서
-- trainer_id가 없음. 날짜 x 결과(성공/실패) 조합마다 그날의 건수 하나씩만 있으면 되므로 이 둘을 묶어 유니크로 둠.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table workin_results (
  id uuid primary key default gen_random_uuid(),
  result_date date not null,
  result text not null check (result in ('success', 'fail')),
  count integer not null default 0 check (count >= 0),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (result_date, result)
);

alter table workin_results enable row level security;

-- 문의 경로와 마찬가지로, 상담 결과도 트레이너 누구든 그때그때 바로 기록하는 게 편해서 로그인한
-- 직원이면 누구나 전체를 보고 기록할 수 있게 함(공용 집계표)
create policy "워크인 결과 조회" on workin_results for select using (auth.uid() is not null);
create policy "워크인 결과 기록" on workin_results for insert with check (auth.uid() is not null);
create policy "워크인 결과 수정" on workin_results for update using (auth.uid() is not null);

create index if not exists workin_results_date_idx on workin_results (result_date);
