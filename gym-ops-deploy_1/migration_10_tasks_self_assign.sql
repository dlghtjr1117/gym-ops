-- 업무 리스트: 기존에는 지점장만 업무를 등록할 수 있었는데,
-- 트레이너 본인도 자기 앞으로 업무를 직접 추가할 수 있도록 등록 권한을 넓힘
-- (지점장은 그대로 누구에게든 업무를 배정 가능, 트레이너는 담당자가 본인일 때만 등록 가능)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

drop policy if exists "업무 등록" on tasks;
create policy "업무 등록" on tasks for insert
  with check (is_manager() or assignee_id = auth.uid());
