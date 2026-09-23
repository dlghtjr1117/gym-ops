-- 그룹PT MVP 보너스 - "내 명예 훈장" 화면에 그동안 받은 트로피 이력을 보여주기 위한 함수.
-- "100P 증정 확인을 누르면 트로피 증정 화면도 뜨고, 확인하면 트로피가 명예 훈장 칸으로
-- 날아가서 쌓이고, 트로피를 받으면 이름 옆에 출석왕 배지도 뜨게 해달라"는 요청으로 추가함.
-- 새 테이블은 필요 없음(이미 있는 group_pt_mvp_bonus_claims에 회원이 몇 월에 몇 등을 해서
-- 받았는지가 전부 기록돼 있음) - 이 함수는 그걸 회원 본인 것만 최신순으로 돌려줌.
--
-- attend.html은 로그인 없는 화면이라 다른 함수들과 같은 패턴(SECURITY DEFINER + anon 권한)으로
-- 만들었고, RETURNS TABLE 출력 컬럼 이름(bonus_year/bonus_month/rank)이 테이블 컬럼 이름과
-- 겹쳐서 생기는 "column reference is ambiguous" 문제(migration_59에서 고친 버그와 같은 종류)를
-- 처음부터 피하려고 테이블에 별칭(c)을 붙여서 c.bonus_year처럼 명확하게 씀.
--
-- 참고: 이호석 테스트 계정(010-6227-7915)은 migration_58/59에서 claims 테이블에 기록을 아예
-- 안 남기게 해놨기 때문에, 이 함수도 그 계정에 대해서는 자연스럽게 항상 빈 목록을 돌려줌 -
-- 그래서 새로고침하면 명예 훈장도 항상 빈 상태로 돌아가고, 반복 테스트할 때마다 트로피를
-- 새로 받는 과정을 처음부터 다시 볼 수 있음(의도된 동작).

create or replace function group_pt_mvp_bonus_history(p_member_id uuid)
returns table (bonus_year integer, bonus_month integer, rank integer)
language sql
security definer
set search_path = public
as $$
  select c.bonus_year, c.bonus_month, c.rank
  from group_pt_mvp_bonus_claims c
  where c.member_id = p_member_id
  order by c.bonus_year desc, c.bonus_month desc;
$$;
grant execute on function group_pt_mvp_bonus_history(uuid) to anon;
