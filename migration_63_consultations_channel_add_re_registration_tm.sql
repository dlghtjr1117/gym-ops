-- 신규상담·워크인 관리(consultations.html) "유입경로"에 "재등록TM" 항목 추가
-- 요청: "유입경로에 재등록TM도 추가해줘"
--
-- channel 컬럼은 migration_52에서 만들 때 check (channel in (...))로 값을 제한해뒀어서, 화면(select
-- 옵션)에만 추가하면 실제로 "재등록TM"을 저장하려 할 때 DB가 거부함. 그래서 이 제약을 다시 만들어서
-- 허용 목록에 're_registration_tm'을 추가함.
--
-- 참고: migration_52에서 컬럼에 이름을 안 붙이고 check(...)만 썼기 때문에, Postgres가 자동으로
-- "walkin_consultations_channel_check"라는 이름을 붙여줌(테이블명_컬럼명_check 규칙) - 그 이름으로
-- drop 하고 같은 이름으로 다시 만듦.
alter table walkin_consultations drop constraint if exists walkin_consultations_channel_check;
alter table walkin_consultations add constraint walkin_consultations_channel_check
  check (channel in (
    'naver_place', 'carrot', 'blog', 'referral',
    'instagram', 'meta_ads', 'flyer', 'walk_by', 're_registration_tm'
  ));
