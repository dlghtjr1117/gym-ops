-- OT 관리 탭에 "OT 연락 미응답"(OT 잡으려고 연락드렸는데 응답이 없으셨던 분) 기록을
-- 따로 남길 수 있는 표를 추가하기 위한 테이블. OT1/OT2처럼 특정 날짜에 잡힌 세션이 아니라
-- "연락은 시도했지만 아직 일정조차 못 잡은" 단계를 기록하는 용도라서 pt_leads와 별도 테이블로 분리함.
-- pt_care_logs와 동일하게 트레이너별 · 월별로 기록이 따로 쌓임 (다른 달로 넘어가도 지난 기록은 보존됨)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table pt_ot_no_response (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid references profiles(id) not null,
  period_month text not null,   -- 'YYYY-MM'
  contact_date date,
  name text not null,
  memo text,
  created_at timestamptz default now()
);

alter table pt_ot_no_response enable row level security;

create policy "OT미응답 조회" on pt_ot_no_response for select using (is_manager() or trainer_id = auth.uid());
create policy "OT미응답 등록" on pt_ot_no_response for insert with check (is_manager() or trainer_id = auth.uid());
create policy "OT미응답 수정" on pt_ot_no_response for update using (is_manager() or trainer_id = auth.uid());
create policy "OT미응답 삭제" on pt_ot_no_response for delete using (is_manager() or trainer_id = auth.uid());
