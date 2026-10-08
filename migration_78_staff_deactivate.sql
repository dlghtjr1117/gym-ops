-- 직원 "삭제(퇴사 처리)" - 직원 관리 화면에서 직원을 삭제하면:
--   1) 로그인 계정이 막혀요(다시 로그인 불가, 기존 로그인도 풀림)
--   2) 담당자/트레이너 선택 목록, 성과 지표 등 "현재 직원" 화면에서 사라져요
--   3) 그 직원의 매출 · PT · 회원 담당 기록은 하나도 지우지 않고 그대로 남아요 (이름도 그대로 보여요)
-- 기록(매출 등)이 직원 행(profiles)을 참조하고 있어서 행 자체를 진짜로 지우면 기록이 깨지기 때문에,
-- 행은 남기고 "퇴사(is_active=false)" 표시만 해요. 실수로 삭제했으면 직원 관리의 "퇴사한 직원 보기"에서 복구할 수 있어요.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. 여러 번 실행해도 안전해요.

alter table profiles add column if not exists is_active boolean not null default true;
alter table profiles add column if not exists deactivated_at timestamptz;

-- 퇴사 처리된 사람은 (혹시 로그인 정보가 남아 있어도) 지점장 권한이 안 먹게
create or replace function public.is_manager()
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'manager' and is_active
  );
$$ language sql security definer stable;

-- 지점장만 호출 가능. 본인은 퇴사 처리할 수 없음.
create or replace function public.deactivate_staff(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_manager() then
    raise exception '지점장만 직원을 삭제할 수 있어요.';
  end if;
  if p_id = auth.uid() then
    raise exception '본인 계정은 삭제할 수 없어요.';
  end if;
  update profiles set is_active = false, deactivated_at = now() where id = p_id;
  -- 로그인 차단 + 이미 로그인된 기기 로그아웃 (실패해도 위의 is_active 표시와 앱 쪽 확인으로 로그인은 막혀요)
  begin
    update auth.users set banned_until = 'infinity' where id = p_id;
  exception when others then null;
  end;
  begin
    delete from auth.sessions where user_id = p_id;
  exception when others then null;
  end;
end;
$$;

create or replace function public.reactivate_staff(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_manager() then
    raise exception '지점장만 직원을 복구할 수 있어요.';
  end if;
  update profiles set is_active = true, deactivated_at = null where id = p_id;
  begin
    update auth.users set banned_until = null where id = p_id;
  exception when others then null;
  end;
end;
$$;

grant execute on function public.deactivate_staff(uuid) to authenticated;
grant execute on function public.reactivate_staff(uuid) to authenticated;

-- PT 매출 순위표(get_pt_trainer_leaderboard): 퇴사한 직원은 그 달에 등록 기록이 있을 때만 보여줌 (과거 달 기록 보존)
create or replace function get_pt_trainer_leaderboard(p_month_start date, p_month_end date)
returns table (
  trainer_id uuid,
  trainer_name text,
  trainer_role text,
  confirmed_total numeric,
  confirmed_count integer,
  ot_total numeric,
  renewal_total numeric,
  trial_total numeric,
  other_total numeric,
  target_amount numeric
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as trainer_id,
    p.name as trainer_name,
    p.role as trainer_role,
    coalesce(sum(l.expected_amount) filter (where l.stage = 'registered'), 0) as confirmed_total,
    count(*) filter (where l.stage = 'registered')::int as confirmed_count,
    coalesce(sum(l.expected_amount) filter (where l.stage = 'registered' and l.source = '오티'), 0) as ot_total,
    coalesce(sum(l.expected_amount) filter (where l.stage = 'registered' and l.source = '재등록'), 0) as renewal_total,
    coalesce(sum(l.expected_amount) filter (where l.stage = 'registered' and l.source = '무료체험'), 0) as trial_total,
    coalesce(sum(l.expected_amount) filter (
      where l.stage = 'registered' and (l.source is null or l.source not in ('오티', '재등록', '무료체험'))
    ), 0) as other_total,
    coalesce((
      select t.target_amount from pt_targets t
      where t.trainer_id = p.id and t.period_type = 'monthly' and t.period_start = p_month_start
    ), 0) as target_amount
  from profiles p
  left join pt_leads l
    on l.trainer_id = p.id
    and (
      (l.contact_date >= p_month_start and l.contact_date < p_month_end)
      or (l.ot_date >= p_month_start and l.ot_date < p_month_end)
    )
  where p.role in ('trainer', 'manager')
  group by p.id, p.name, p.role, p.is_active
  having p.is_active or count(l.id) > 0
  order by confirmed_total desc;
$$;

grant execute on function get_pt_trainer_leaderboard(date, date) to authenticated;

notify pgrst, 'reload schema';
