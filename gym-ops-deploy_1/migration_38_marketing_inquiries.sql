-- 마케팅 문의 경로 일지(pt.html "문의 경로" 탭): 예전에 엑셀 시트로 손으로 적던 일별 문의 채널 집계표를
-- 앱으로 옮긴 것. 트레이너 개인 기록이 아니라 센터 전체가 같이 보는 공용 집계라서 trainer_id가 없음.
-- 날짜 x 카테고리(헬스/올바른운동그룹PT) x 채널(전화/네이버톡톡/네이버예약/인스타/카카오/당근) 조합마다
-- 그날의 문의 건수 하나씩만 있으면 되므로(이름표는 없이 숫자만 세는 방식) 이 세 개를 묶어 유니크로 둠.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table marketing_inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_date date not null,
  category text not null check (category in ('gym', 'group_pt')),  -- gym(헬스이용권·1:1PT) / group_pt(올바른운동 그룹PT)
  channel text not null check (channel in ('phone', 'naver_talk', 'naver_booking', 'instagram', 'kakao', 'carrot')),
  count integer not null default 0 check (count >= 0),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (inquiry_date, category, channel)
);

alter table marketing_inquiries enable row level security;

-- 전화·톡톡 응대는 지점장뿐 아니라 트레이너도 그때그때 바로 기록하는 게 편해서, 다른 PT 관리 데이터와
-- 달리 트레이너 본인 것만이 아니라 로그인한 직원이면 누구나 전체를 보고 기록할 수 있게 함(공용 집계표)
create policy "문의 경로 조회" on marketing_inquiries for select using (auth.uid() is not null);
create policy "문의 경로 기록" on marketing_inquiries for insert with check (auth.uid() is not null);
create policy "문의 경로 수정" on marketing_inquiries for update using (auth.uid() is not null);

create index if not exists marketing_inquiries_date_idx on marketing_inquiries (inquiry_date);
