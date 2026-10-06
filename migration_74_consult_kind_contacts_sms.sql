-- 신규상담·워크인 관리 개편 (2026-10-06)
--  1) 한 표에 섞여 있던 기록을 "워크인(직접 방문)"과 "TM(전화상담)"으로 나눠 저장 - kind 칸 추가
--  2) 1차 / 2차 / 3차 연락일 칸 추가
--  3) 이월·거부 회원에게 보낸 문자 발송 이력 테이블 추가 (실제 발송은 Supabase Edge Function이 함)
--
-- "등록 / 이월 / 거부(미스)로 처리된 기록을 따로 보관"하는 부분은 DB에 칸을 더 만들지 않고,
-- 기존 status 값(considering 아니면 처리 완료)으로 화면에서 구분함 - 그래서 통계(등록률 등)는
-- 그대로 계산되고, 되돌리기는 status를 다시 considering으로 바꾸는 것뿐임.
--
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. 이미 한 번 실행했어도 다시 실행해도 안전함
-- (기존 기록 자동 분류는 kind 칸을 처음 만드는 이번 한 번만 실행됨).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'walkin_consultations' and column_name = 'kind'
  ) then
    alter table walkin_consultations
      add column kind text not null default 'walkin' check (kind in ('walkin', 'tm'));
    -- 이미 쌓인 기록은 유입경로로 자동 분류: 재등록TM / 자동통화 = TM(전화상담), 나머지 = 워크인
    update walkin_consultations set kind = 'tm' where channel in ('re_registration_tm', 'phone_auto');
  end if;
end $$;

alter table walkin_consultations add column if not exists contact1_date date;
alter table walkin_consultations add column if not exists contact2_date date;
alter table walkin_consultations add column if not exists contact3_date date;

create index if not exists walkin_consultations_kind_status_idx on walkin_consultations (kind, status);

-- ---- 문자 발송 이력 ----
-- 발송은 브라우저가 아니라 Supabase Edge Function(send-sms)이 문자 업체 API를 호출해서 하고, 그 결과를
-- 아래 두 표에 서버 권한으로 기록함. 그래서 화면(브라우저)에는 insert 권한을 아예 안 주고 "조회"만 줌.
create table if not exists sms_campaigns (
  id uuid primary key default gen_random_uuid(),
  sent_by uuid references profiles(id),
  message text not null,            -- 직원이 쓴 본문
  final_text text,                  -- 실제로 나간 문구 ((광고) 표기·수신거부 안내가 붙은 최종본)
  is_ad boolean not null default true,
  recipient_count integer not null default 0,
  success_count integer not null default 0,
  fail_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists sms_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references sms_campaigns(id) on delete cascade,
  consult_id uuid references walkin_consultations(id) on delete set null,
  name text,
  phone text,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists sms_messages_campaign_idx on sms_messages (campaign_id);
create index if not exists sms_messages_consult_idx on sms_messages (consult_id);

alter table sms_campaigns enable row level security;
alter table sms_messages enable row level security;

drop policy if exists "문자발송이력 조회" on sms_campaigns;
create policy "문자발송이력 조회" on sms_campaigns for select using (is_manager());
drop policy if exists "문자발송내역 조회" on sms_messages;
create policy "문자발송내역 조회" on sms_messages for select using (is_manager());

notify pgrst, 'reload schema';
