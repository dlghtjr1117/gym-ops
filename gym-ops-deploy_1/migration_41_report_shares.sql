-- 매출 보고 공유 링크(report.html): "캡쳐해서 일일이 보내지 말고 노션처럼 링크 하나로 보여주고
-- 싶다"는 요청으로 추가. 로그인 없이 링크만 있으면 누구나 볼 수 있게 하되, 실시간 데이터가 아니라
-- "공유 버튼을 누른 그 순간"의 숫자를 그대로 고정해서 보여주는 스냅샷 방식임(호석님이 "스냅샷(고정된
-- 기록)"을 선택함 - 이후 매출이 추가돼도 이미 만든 링크의 숫자는 안 바뀜, PDF/캡쳐 이미지를 보내는
--것과 비슷한 개념).
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table report_shares (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table report_shares enable row level security;

-- 공유 링크를 만드는 건 로그인한 직원만 가능
create policy "공유 링크 생성" on report_shares for insert with check (auth.uid() is not null);
-- 만든 사람만 자기가 만든 공유 링크 목록을 보고(대시보드의 "지난 공유 링크" 관리 화면) 지울 수 있음.
-- 공개 열람(로그인 없이 report.html에서 보는 것)은 이 정책이 아니라 아래 get_report_share() 함수를
-- 통해서만 이뤄짐 - 링크의 id를 정확히 모르면 이 테이블을 조회할 방법이 없음.
create policy "공유 링크 목록 조회(본인 것만)" on report_shares for select using (created_by = auth.uid());
create policy "공유 링크 삭제(본인 것만)" on report_shares for delete using (created_by = auth.uid());

-- 공개 열람용 함수: 로그인 없이(anon 권한으로) 정확한 id(uuid)를 아는 사람만 그 한 건의 snapshot을
-- 읽을 수 있음. SECURITY DEFINER라 위의 "본인 것만 select" 정책을 우회하지만, 이 함수 자체가 목록
-- 조회 없이 "정확히 일치하는 한 건"만 돌려주기 때문에, 링크의 id를 모르면(추측이 사실상 불가능한
-- uuid라서) 어떤 데이터도 볼 수 없음 - 노션 "링크가 있는 사람은 누구나 보기"와 같은 보안 모델.
create or replace function get_report_share(share_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select snapshot from report_shares where id = share_id;
$$;

grant execute on function get_report_share(uuid) to anon, authenticated;

create index if not exists report_shares_created_by_idx on report_shares (created_by);
