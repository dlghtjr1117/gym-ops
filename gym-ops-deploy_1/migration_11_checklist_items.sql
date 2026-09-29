-- 청소 업무 체크리스트 (마이크로소프트 투두 스타일의 반복 개인 체크리스트)
-- 각 선생님이 자기 리스트를 직접 만들고 체크하는 용도. 지점장은 전체 조회만 가능.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) not null,
  title text not null,
  repeat_type text not null default 'none' check (repeat_type in ('none','daily','weekly')),
  repeat_weekday int check (repeat_weekday between 0 and 6), -- 0=일,1=월,...6=토 (매주 반복일 때만 사용)
  last_completed_at timestamptz,
  created_at timestamptz default now()
);

alter table checklist_items enable row level security;

-- 조회: 본인 리스트는 항상, 지점장은 전체 리스트 조회 가능(모니터링용, 체크/수정은 불가)
create policy "체크리스트 조회" on checklist_items for select
  using (is_manager() or owner_id = auth.uid());

-- 등록/체크·해제/삭제: 반드시 본인 리스트에만 (지점장도 본인 것만 가능, 트레이너 대신 못 건드림)
create policy "체크리스트 등록" on checklist_items for insert
  with check (owner_id = auth.uid());
create policy "체크리스트 수정" on checklist_items for update
  using (owner_id = auth.uid());
create policy "체크리스트 삭제" on checklist_items for delete
  using (owner_id = auth.uid());
