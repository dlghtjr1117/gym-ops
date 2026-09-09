-- "올바른 운동 무제한" 그룹PT인데 참석이 뜸해진 회원에게 초심자패키지 5회로 전환을 제안하는
-- TM(연락) 기록을 위한 전용 공간. tm_logs를 그대로 재사용할 수도 있었지만:
--  1) tm_logs.status는 CHECK 제약으로 '재등록/이월/거부' 등 특정 값만 허용하는데, 여기서 필요한
--     상태(연락함/초심자패키지 제안함/전환 완료/보류)와 의미가 안 맞음.
--  2) 대시보드의 "이번 달 재등록 확률"·"상품별 재등록 현황"이 tm_logs 전체를 카테고리 구분 없이
--     훑어서 집계하기 때문에, 여기 기록이 섞이면(특히 "전환 완료"를 재등록 status로 넣을 경우)
--     그 숫자들이 실제와 다르게 계산될 위험이 있음.
-- 그래서 완전히 분리된 테이블로 새로 만듦.

-- 회원의 "바디코디에서 마지막으로 방문한 날짜" (엑셀 업로드로 갱신). 그룹PT 참석 여부를
-- 자동으로 기록하는 출석부가 없어서, 이미 갖고 계신 바디코디 데이터를 그대로 활용하는 방식.
alter table members add column if not exists last_visit_date date;

create table if not exists group_pt_retention_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) not null,
  staff_id uuid references profiles(id),
  contact_date date default current_date,
  status text not null default 'not_contacted'
    check (status in ('not_contacted', 'contacted', 'proposed', 'converted', 'declined', 'on_hold')),
  memo text,
  created_at timestamptz default now()
);

alter table group_pt_retention_logs enable row level security;

-- tm_logs와 같은 권한 구조: 지점장은 전체, 트레이너는 본인 담당(staff_id)만
create policy "그룹PT 전환TM 조회" on group_pt_retention_logs for select using (is_manager() or staff_id = auth.uid());
create policy "그룹PT 전환TM 등록" on group_pt_retention_logs for insert with check (is_manager() or staff_id = auth.uid());
create policy "그룹PT 전환TM 수정" on group_pt_retention_logs for update using (is_manager() or staff_id = auth.uid());
create policy "그룹PT 전환TM 삭제" on group_pt_retention_logs for delete using (is_manager());
