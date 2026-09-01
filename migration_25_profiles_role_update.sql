-- 지점장이 앱 화면 안에서 직접 다른 직원의 권한(트레이너 <-> 지점장)을 바꿀 수 있도록
-- profiles 테이블에 UPDATE 정책 추가 (지금까지는 지점장이라도 앱에서 role을 바꿀 방법이 없어서
-- Supabase 대시보드 Table Editor에 직접 들어가서 수동으로 바꿔야 했음)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create policy "직원 권한 변경(지점장 전용)" on profiles for update using (is_manager()) with check (is_manager());
