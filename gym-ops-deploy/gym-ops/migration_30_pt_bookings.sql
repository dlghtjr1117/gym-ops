-- PT 스케줄(schedule.html): 트레이너별로 시간대에 회원 수업을 배정해두고, 출석/결석/취소 처리를 할 수 있는 표.
-- 출석 처리를 누르면 members.pt_remaining_sessions(개인PT 잔여횟수)가 1회 자동으로 차감됨.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table pt_bookings (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references profiles(id),
  member_id uuid not null references members(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'booked',  -- booked(예약) / attended(출석) / absent(결석) / cancelled(취소)
  memo text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table pt_bookings enable row level security;

-- 다른 PT 관리 데이터와 동일한 규칙: 지점장은 전체, 트레이너는 본인 스케줄만
create policy "PT 스케줄 조회" on pt_bookings for select using (is_manager() or trainer_id = auth.uid());
create policy "PT 스케줄 등록" on pt_bookings for insert with check (is_manager() or trainer_id = auth.uid());
create policy "PT 스케줄 수정" on pt_bookings for update using (is_manager() or trainer_id = auth.uid());
create policy "PT 스케줄 삭제" on pt_bookings for delete using (is_manager() or trainer_id = auth.uid());

create index if not exists pt_bookings_trainer_time_idx on pt_bookings (trainer_id, start_at);
