-- 포인트 상점에 "쿠폰" 상품 추가 - 첫 쿠폰: 회원권(헬스 이용권) 20% 할인 쿠폰
-- · 포인트 가격은 아직 미정이라 비워두고(NULL), 지점장이 직원 화면(그룹PT 출석 > 포인트 상점 관리)에서 입력하면 그때부터 교환 가능
--   (가격이 비어 있는 동안 회원 화면에는 "포인트 준비중 / 곧 오픈!"으로만 보이고 교환은 안 돼요)
-- · 교환하면 포인트가 서버에서 차감되고 쿠폰(쿠폰번호 + 유효기간 30일)이 발급돼요. 회원은 "내 쿠폰"에서 확인
-- · 프런트에서 쿠폰을 확인하고 20% 할인해서 결제한 뒤, 직원 화면에서 "사용 처리"(한 번 처리하면 다시 못 씀)
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. 여러 번 실행해도 안전해요. (migration_64 이후에 실행)

-- ---- 상품 테이블 확장 ----
alter table group_pt_shop_items add column if not exists item_type text not null default 'gift';
alter table group_pt_shop_items drop constraint if exists group_pt_shop_items_item_type_check;
alter table group_pt_shop_items add constraint group_pt_shop_items_item_type_check check (item_type in ('gift', 'coupon'));
alter table group_pt_shop_items add column if not exists discount_percent integer;
alter table group_pt_shop_items add column if not exists valid_days integer;
-- 가격 미정(NULL) 허용: 값이 있으면 0보다 커야 함
alter table group_pt_shop_items alter column points_cost drop not null;
alter table group_pt_shop_items drop constraint if exists group_pt_shop_items_points_cost_check;
alter table group_pt_shop_items add constraint group_pt_shop_items_points_cost_check check (points_cost is null or points_cost > 0);

-- 상품 추가/수정/삭제는 지점장만 (예전엔 로그인한 직원 누구나 가능했음). 조회는 로그인한 직원 전체 그대로.
drop policy if exists "포인트상점상품 등록" on group_pt_shop_items;
drop policy if exists "포인트상점상품 수정" on group_pt_shop_items;
drop policy if exists "포인트상점상품 삭제" on group_pt_shop_items;
create policy "포인트상점상품 등록" on group_pt_shop_items for insert with check (is_manager());
create policy "포인트상점상품 수정" on group_pt_shop_items for update using (is_manager());
create policy "포인트상점상품 삭제" on group_pt_shop_items for delete using (is_manager());

-- ---- 교환 내역 확장: 쿠폰 발급 정보 ----
alter table group_pt_point_redemptions add column if not exists item_type text not null default 'gift';
alter table group_pt_point_redemptions add column if not exists discount_percent integer;
alter table group_pt_point_redemptions add column if not exists coupon_code text;
alter table group_pt_point_redemptions add column if not exists expires_at timestamptz;
alter table group_pt_point_redemptions add column if not exists used_at timestamptz;
alter table group_pt_point_redemptions add column if not exists used_by uuid references profiles(id) on delete set null;
create unique index if not exists group_pt_point_redemptions_coupon_code_idx on group_pt_point_redemptions (coupon_code) where coupon_code is not null;

-- 첫 쿠폰 상품 (한 번만 넣음). 가격(points_cost)은 비워둠 - 정해지면 직원 화면에서 입력
insert into group_pt_shop_items (name, emoji, points_cost, sort_order, active, item_type, discount_percent, valid_days)
select '회원권 20% 할인 쿠폰', '🏷️', null, 0, true, 'coupon', 20, 30
where not exists (select 1 from group_pt_shop_items where item_type = 'coupon' and discount_percent = 20);

-- ============================================================================
-- group_pt_get_member_status: shop_items에 상품 종류/할인율/유효일, 그리고 내 쿠폰 목록(coupons) 추가
-- (반환 컬럼이 늘어나서 기존 함수를 지우고 다시 만듦. 나머지 내용은 migration_64와 동일)
-- ============================================================================
drop function if exists group_pt_get_member_status(uuid);
create function group_pt_get_member_status(p_member_id uuid)
returns table (
  display_name text,
  class_label text,
  total_days integer,
  total_points integer,
  available_points integer,
  attendance_dates date[],
  tiers jsonb,
  shop_items jsonb,
  coupons jsonb
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
    coalesce(si.items, '[]'::jsonb),
    coalesce(cp.coupons, '[]'::jsonb)
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
      'id', gi.id, 'name', gi.name, 'emoji', gi.emoji, 'points_cost', gi.points_cost,
      'item_type', gi.item_type, 'discount_percent', gi.discount_percent, 'valid_days', gi.valid_days
    ) order by gi.sort_order) as items
    from group_pt_shop_items gi
    where gi.active = true
  ) si on true
  left join (
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.item_name, 'emoji', r.item_emoji, 'discount_percent', r.discount_percent,
      'coupon_code', r.coupon_code, 'redeemed_at', r.redeemed_at, 'expires_at', r.expires_at, 'used_at', r.used_at
    ) order by r.redeemed_at desc) as coupons
    from group_pt_point_redemptions r
    where r.member_id = p_member_id and r.item_type = 'coupon'
  ) cp on true
  where m.id = p_member_id;
end;
$$;
grant execute on function group_pt_get_member_status(uuid) to anon;

-- ============================================================================
-- group_pt_redeem_item: 쿠폰이면 가격 미정일 때 막고, 교환 시 쿠폰번호/유효기간을 같이 발급
-- ============================================================================
drop function if exists group_pt_redeem_item(uuid, uuid);
create function group_pt_redeem_item(p_member_id uuid, p_item_id uuid)
returns table (ok boolean, message text, item_name text, item_emoji text, points_spent integer, available_points integer,
               item_type text, coupon_code text, expires_at timestamptz, discount_percent integer)
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
  v_code text;
  v_expires timestamptz;
  v_tries integer := 0;
begin
  if not exists (select 1 from members mm where mm.id = p_member_id and mm.group_pt_type is not null) then
    return query select false, '회원 정보를 찾을 수 없어요.', null::text, null::text, 0, 0, null::text, null::text, null::timestamptz, null::integer;
    return;
  end if;

  select gi.id, gi.name, gi.emoji, gi.points_cost, gi.item_type, gi.discount_percent, gi.valid_days into v_item
  from group_pt_shop_items gi
  where gi.id = p_item_id and gi.active = true;

  if v_item.id is null then
    return query select false, '더 이상 교환할 수 없는 상품이에요.', null::text, null::text, 0, 0, null::text, null::text, null::timestamptz, null::integer;
    return;
  end if;
  if v_item.points_cost is null then
    return query select false, '아직 교환 포인트가 정해지지 않았어요. 곧 오픈할 예정이에요!', v_item.name, v_item.emoji, 0, 0, v_item.item_type, null::text, null::timestamptz, v_item.discount_percent;
    return;
  end if;

  select coalesce((select count(*) from group_pt_attendance ga where ga.member_id = p_member_id), 0) * v_points_per_checkin
       + coalesce((select sum(mb.bonus_points) from group_pt_mvp_bonus_claims mb where mb.member_id = p_member_id), 0)
  into v_total_points;

  select coalesce(sum(pr.points_spent), 0) into v_spent_sum
  from group_pt_point_redemptions pr where pr.member_id = p_member_id;

  v_available := v_total_points - v_spent_sum;

  if v_available < v_item.points_cost then
    return query select false, '포인트가 부족해요.', v_item.name, v_item.emoji, 0, v_available, v_item.item_type, null::text, null::timestamptz, v_item.discount_percent;
    return;
  end if;

  if v_item.item_type = 'coupon' then
    v_expires := now() + make_interval(days => coalesce(v_item.valid_days, 30));
    loop
      v_code := 'EF-' || upper(substr(md5(random()::text || clock_timestamp()::text || p_member_id::text), 1, 4));
      exit when not exists (select 1 from group_pt_point_redemptions r where r.coupon_code = v_code);
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception '쿠폰번호 발급에 실패했어요. 다시 시도해주세요.'; end if;
    end loop;
  end if;

  insert into group_pt_point_redemptions (member_id, item_id, item_name, item_emoji, points_spent, item_type, discount_percent, coupon_code, expires_at)
  values (p_member_id, v_item.id, v_item.name, v_item.emoji, v_item.points_cost, v_item.item_type, v_item.discount_percent, v_code, v_expires);

  return query select true, '교환 완료!', v_item.name, v_item.emoji, v_item.points_cost, (v_available - v_item.points_cost),
                      v_item.item_type, v_code, v_expires, v_item.discount_percent;
end;
$$;
grant execute on function group_pt_redeem_item(uuid, uuid) to anon;

-- ============================================================================
-- 직원용: 쿠폰 사용 처리 / 사용 취소(실수로 눌렀을 때, 지점장만)
-- ============================================================================
create or replace function group_pt_use_coupon(p_redemption_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and coalesce(is_active, true)) then
    raise exception '로그인한 직원만 사용 처리할 수 있어요.';
  end if;
  select * into v_row from group_pt_point_redemptions where id = p_redemption_id and item_type = 'coupon' for update;
  if v_row.id is null then raise exception '쿠폰을 찾을 수 없어요.'; end if;
  if v_row.used_at is not null then raise exception '이미 사용 처리된 쿠폰이에요.'; end if;
  if v_row.expires_at is not null and v_row.expires_at < now() then raise exception '유효기간이 지난 쿠폰이에요.'; end if;
  update group_pt_point_redemptions set used_at = now(), used_by = auth.uid() where id = p_redemption_id;
end;
$$;
grant execute on function group_pt_use_coupon(uuid) to authenticated;

create or replace function group_pt_unuse_coupon(p_redemption_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_manager() then raise exception '지점장만 사용 취소할 수 있어요.'; end if;
  update group_pt_point_redemptions set used_at = null, used_by = null where id = p_redemption_id and item_type = 'coupon';
end;
$$;
grant execute on function group_pt_unuse_coupon(uuid) to authenticated;

notify pgrst, 'reload schema';
