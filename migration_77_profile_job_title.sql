-- 직급(팀장) 추가 - 권한(role)은 그대로 trainer/manager 두 가지이고, "관리자 중에서 직급이 팀장인 사람"을 구분하는 용도.
-- 팀장(권한은 관리자)은 대시보드 "트레이너 성과 지표"에 포함되고, 지점장은 지금처럼 제외돼요.
-- 직원 관리 화면에서 직급(트레이너 / 팀장 / 지점장)을 바꾸면 이 값이 같이 저장돼요.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. 여러 번 실행해도 안전해요.

alter table profiles add column if not exists job_title text;
alter table profiles drop constraint if exists profiles_job_title_check;
alter table profiles add constraint profiles_job_title_check check (job_title is null or job_title in ('팀장'));

notify pgrst, 'reload schema';
