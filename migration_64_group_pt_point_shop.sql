-- 그룹PT 회원 화면(attend.html)에 "포인트 상점" 추가
-- 요청: "누적 출석일수 칸 클릭하면 옆에 몇 포인트 추가됐는지 함께 뜨게 해주고, 포인트 칸은 상점처럼
--   보이게 해서 클릭하면 포인트 상점으로 들어가게 해줘"
-- 상품 구성은 우선 예시로 4개(아이스 아메리카노 500P / 프로틴 쉐이크 800P / 헬스타올 1500P /
-- PT 1회 체험 쿠폰 3000P)를 넣어두고, 교환은 "앱에서 바로 포인트 차감 완료 처리"(직원 확인 단계 없음)
-- 방식으로 구현함.

-- ---- 상점에 진열할 상품 목록 (지점장이 나중에 Supabase 테이블 편집기에서 직접 추가/수정/비활성화 가능) ----
create table group_pt_shop_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '🎁',
  points_cost integer not null check (points_cost > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table group_pt_shop_items enable row level security;
create policy "포인트상점상품 조회" on group_pt_shop_items for select using (auth.uid() is not null);
create policy "포인트상점상품 등록" on group_pt_shop_items for insert with check (auth.uid() is not null);
create policy "포인트상점상품 수정" on group_pt_shop_items for update using (auth.uid() is not null);
create policy "포인트상점상품 삭제" on group_pt_shop_items for delete using (auth.uid() is not null);

insert into group_pt_shop_items (name, emoji, points_cost, sort_order) values
  ('아이스 아메리카노 1잔', '☕', 500, 1),
  ('프로틴 쉐이크 1개', '🥤', 800, 2),
  ('헬스타올 1장', '🧺', 1500, 3),
  ('PT 1회 체험 쿠폰', '🎟️', 3000, 4);

-- ---- 교환 내역(= 포인트 사용 내역). 상품이 나중에 이름이 바뀌거나 삭제돼도 교환 당시 이름이 그대로
-- 남도록 item_name/item_emoji를 스냅샷으로 같이 저장함 ----
create table group_pt_point_redemptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  item_id uuid references group_pt_shop_items(id) on delete set null,
  item_name text not null,
  item_emoji text not null default '🎁',
  points_spent integer not null check (points_spent > 0),
  redeemed_at timestamptz not null default now()
);
alter table group_pt_point_redemptions enable row level security;
create policy "포인트교환내역 조회" on group_pt_point_redemptions for select using (auth.uid() is not null);
-- insert는 anon에게 이 테이블 직접 권한을 안 주고, 아래 group_pt_redeem_item() 함수(포인트 잔액을
-- 서버에서 다시 계산해서 검증)를 통해서만 이뤄짐 - 클라이언트가 조작해서 공짜로 교환하는 걸 방지
create index group_pt_point_redemptions_member_idx on group_pt_point_redemptions (member_id, redeemed_at desc);

-- ============================================================================
-- group_pt_get_member_status 갱신: available_points(=사용 가능한 잔여 포인트)와 shop_items(진열 상품
-- 목록)를 추가로 실어보냄. total_points는 지금까지 "적립"한 총합(출석+MVP보너스) 그대로 유지하고,
-- available_points = total_points - 지금까지 교환에 쓴 포인트 합계로 새로 계산함.
--
-- 참고(버그 수정): migration_62에서 이 함수를 "아이콘/이미지 필드 추가"만 하려고 다시 만들면서
-- migration_57에서 추가했던 MVP 보너스 포인트 합산(bonus_sum)이 실수로 빠져있었음 - 그 사이엔
-- 회원 화면 포인트에 MVP 보너스가 반영 안 되고 있었던 것. 이번에 다시 포함시켜서 원래대로 고침.
-- ============================================================================
create or replace function group_pt_get_member_status(p_member_id uuid)
returns table (
  display_name text,
  class_label text,
  total_days integer,
  total_points integer,
  available_points integer,
  attendance_dates date[],
  tiers jsonb,
  shop_items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points_per_checkin constant integer := 10;
begin
  return query
  select
    m.name,
    m.group_pt_type,
    coalesce(a.cnt, 0)::int,
    coalesce(a.cnt, 0)::int * v_points_per_checkin + coalesce(b.bonus_sum, 0)::int,
    (coalesce(a.cnt, 0)::int * v_points_per_checkin + coalesce(b.bonus_sum, 0)::int) - coalesce(s.spent_sum, 0)::int,
    coalesce(a.dates, array[]::date[]),
    coalesce(t.tiers, '[]'::jsonb),
    coalesce(si.items, '[]'::jsonb)
  from members m
  left join (
    select member_id, count(*) as cnt, array_agg(attendance_date order by attendance_date) as dates
    from group_pt_attendance
    where member_id = p_member_id
    group by member_id
  ) a on true
  left join (
    select jsonb_agg(jsonb_build_object(
      'days_required', gt.days_required,
      'reward_name', gt.reward_name,
      'icon_emoji', gt.icon_emoji,
      'image_url', gt.image_url,
      'achieved', c.id is not null,
      'fulfilled', coalesce(c.fulfilled, false)
    ) order by gt.days_required) as tiers
    from group_pt_reward_tiers gt
    left join group_pt_reward_claims c on c.tier_id = gt.id and c.member_id = p_member_id
  ) t on true
  left join (
    select member_id, sum(bonus_points) as bonus_sum
    from group_pt_mvp_bonus_claims
    where member_id = p_member_id
    group by member_id
  ) b on true
  left join (
    select member_id, sum(points_spent) as spent_sum
    from group_pt_point_redemptions
    where member_id = p_member_id
    group by member_id
  ) s on true
  left join (
    select jsonb_agg(jsonb_build_object(
      'id', gi.id, 'name', gi.name, 'emoji', gi.emoji, 'points_cost', gi.points_cost
    ) order by gi.sort_order) as items
    from group_pt_shop_items gi
    where gi.active = true
  ) si on true
  where m.id = p_member_id;
end;
$$;
grant execute on function group_pt_get_member_status(uuid) to anon;

-- 실제 교환(포인트 차감) 처리. 클라이언트가 보낸 포인트/잔액은 절대 믿지 않고, 회원의 출석/보너스/이전
-- 교환 내역을 서버에서 전부 다시 더해서 잔액을 계산한 뒤에만 차감함(포인트 조작·중복 교환 방지)
create or replace function group_pt_redeem_item(p_member_id uuid, p_item_id uuid)
returns table (ok boolean, message text, item_name text, item_emoji text, points_spent integer, available_points integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points_per_checkin constant integer := 10;
  v_total_points integer;
  v_spent_sum integer;
  v_available integer;
  v_item record;
begin
  if not exists (select 1 from members where id = p_member_id and group_pt_type is not null) then
    return query select false, '회원 정보를 찾을 수 없어요.', null::text, null::text, 0, 0;
    return;
  end if;

  select gi.id, gi.name, gi.emoji, gi.points_cost into v_item
  from group_pt_shop_items gi
  where gi.id = p_item_id and gi.active = true;

  if v_item.id is null then
    return query select false, '더 이상 교환할 수 없는 상품이에요.', null::text, null::text, 0, 0;
    return;
  end if;

  select coalesce((select count(*) from group_pt_attendance where member_id = p_member_id), 0) * v_points_per_checkin
       + coalesce((select sum(bonus_points) from group_pt_mvp_bonus_claims where member_id = p_member_id), 0)
  into v_total_points;

  select coalesce(sum(points_spent), 0) into v_spent_sum
  from group_pt_point_redemptions where member_id = p_member_id;

  v_available := v_total_points - v_spent_sum;

  if v_available < v_item.points_cost then
    return query select false, '포인트가 부족해요.', v_item.name, v_item.emoji, 0, v_available;
    return;
  end if;

  insert into group_pt_point_redemptions (member_id, item_id, item_name, item_emoji, points_spent)
  values (p_member_id, v_item.id, v_item.name, v_item.emoji, v_item.points_cost);

  return query select true, '교환 완료!', v_item.name, v_item.emoji, v_item.points_cost, (v_available - v_item.points_cost);
end;
$$;
grant execute on function group_pt_redeem_item(uuid, uuid) to anon;
