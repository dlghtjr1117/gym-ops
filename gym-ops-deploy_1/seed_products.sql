-- 이용권(상품) 일괄 등록: 헬스이용권 / 락커 / 운동복 / 개인PT / 그룹PT / 일일입장권
-- Supabase SQL Editor에서 한 번만 실행하시면 됩니다. (이미 등록된 상품이 있어도 중복으로 더 생길 뿐,
--  기존 상품이나 회원 데이터를 건드리지 않으니 안심하고 실행하셔도 됩니다)
--
-- PT는 기간(개월) 없이 "횟수제"로 등록했어요 (기존에 만든 개인PT 10회 상품과 동일한 방식).
-- 만약 PT도 사용기한(예: 10회권은 2개월 이내 사용)을 두고 싶으시면 말씀해주세요, duration_days를 추가해드릴게요.
-- 일일입장권은 딱 맞는 카테고리가 없어서 "헬스이용권(membership)" 카테고리로 넣고 기간을 1일로 설정했어요
--  (이용권 관리 화면에서는 "헬스이용권" 탭에 다른 헬스이용권들과 같이 보여요).

insert into products (name, category, price, duration_days, sessions, active) values
  ('헬스이용권 1개월', 'membership', 110000, 30, null, true),
  ('헬스이용권 3개월', 'membership', 210000, 90, null, true),
  ('헬스이용권 6개월', 'membership', 270000, 180, null, true),
  ('헬스이용권 12개월', 'membership', 399000, 360, null, true),
  ('일일입장권', 'membership', 20000, 1, null, true),
  ('락커 1개월', 'locker', 10000, 30, null, true),
  ('운동복 1개월', 'clothes', 10000, 30, null, true),
  ('개인PT 10회', 'pt', 770000, null, 10, true),
  ('개인PT 20회', 'pt', 1320000, null, 20, true),
  ('개인PT 30회', 'pt', 1815000, null, 30, true),
  ('개인PT 50회', 'pt', 2900000, null, 50, true),
  ('개인PT 100회', 'pt', 5500000, null, 100, true),
  ('올바른 운동 무제한 3개월권', 'group_pt', 693000, 90, null, true),
  ('올바른 운동 무제한 6개월권', 'group_pt', 1140000, 180, null, true),
  ('올바른 운동 무제한 12개월권', 'group_pt', 1932000, 360, null, true);
