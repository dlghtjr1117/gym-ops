-- 출석 리워드(보상 로드맵) 새 디자인 적용
-- "보상 로드맵을 조금 더 구체적이고 정교하게 만들고 싶어. 40회 텀블러, 70회 상의, 100회 신발"
-- 요청에 따라 기존 30/60/90일(스티커팩/티셔츠/스탠리 텀블러) 3단계를 40/70/100일(텀블러/상의/신발)로
-- 바꾸고, 각 단계마다 카드/상세화면에 보여줄 아이콘(이모지) 또는 실제 상품 사진을 지정할 수 있게
-- image_url 컬럼을 추가함.
--
-- 주의: 기존 group_pt_reward_tiers 행을 지우고 새로 만드는(delete+insert) 대신 UPDATE로 바꿈 - 만약
-- 예전 기준(30/60/90일)으로 이미 달성/지급된 회원이 있다면 그 기록(group_pt_reward_claims)이 tier_id를
-- 참조하고 있어서, 행을 지워버리면 그 회원의 "이미 받은 리워드" 기록도 같이 날아가 버림. UPDATE로
-- 같은 tier_id를 유지하면 과거에 이미 달성/수령한 회원의 기록은 그대로 보존됨.
alter table group_pt_reward_tiers add column if not exists icon_emoji text;
alter table group_pt_reward_tiers add column if not exists image_url text;

update group_pt_reward_tiers set days_required = 40, reward_name = '보온보냉 텀블러', icon_emoji = '🥤', image_url = 'reward-tumbler.png', sort_order = 1 where days_required = 30;
update group_pt_reward_tiers set days_required = 70, reward_name = '브랜드 상의', icon_emoji = '👕', image_url = null, sort_order = 2 where days_required = 60;
update group_pt_reward_tiers set days_required = 100, reward_name = '운동화', icon_emoji = '👟', image_url = null, sort_order = 3 where days_required = 90;

-- 혹시 위 UPDATE 대상(30/60/90일)이 이미 다른 값으로 바뀌어 있어서 매칭이 안 됐을 경우를 대비한 안전장치 -
-- 위 3개 UPDATE 후에도 40/70/100일 단계가 없다면 새로 추가함(현재 단계가 몇 개든 상관없이 항상
-- 40/70/100일 3단계가 존재하도록 보장).
insert into group_pt_reward_tiers (days_required, reward_name, icon_emoji, image_url, sort_order)
select 40, '보온보냉 텀블러', '🥤', 'reward-tumbler.png', 1
where not exists (select 1 from group_pt_reward_tiers where days_required = 40);

insert into group_pt_reward_tiers (days_required, reward_name, icon_emoji, image_url, sort_order)
select 70, '브랜드 상의', '👕', null, 2
where not exists (select 1 from group_pt_reward_tiers where days_required = 70);

insert into group_pt_reward_tiers (days_required, reward_name, icon_emoji, image_url, sort_order)
select 100, '운동화', '👟', null, 3
where not exists (select 1 from group_pt_reward_tiers where days_required = 100);

-- group_pt_get_member_status가 돌려주는 tiers JSON에 icon_emoji/image_url도 같이 실어보냄(attend.html이
-- 로드맵 트랙/카드/상세화면에서 이미지 또는 이모지를 바로 그릴 수 있게).
create or replace function group_pt_get_member_status(p_member_id uuid)
returns table (
  display_name text,
  class_label text,
  total_days integer,
  total_points integer,
  attendance_dates date[],
  tiers jsonb
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
    coalesce(a.cnt, 0)::int * v_points_per_checkin,
    coalesce(a.dates, array[]::date[]),
    coalesce(t.tiers, '[]'::jsonb)
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
  where m.id = p_member_id;
end;
$$;
grant execute on function group_pt_get_member_status(uuid) to anon;
