-- 센터 규정 · 업무 매뉴얼 페이지(rules.html) - 환불 절차 / 양도 / 무료 이용권 같은 규정을 선생님들이
-- 직접 찾아볼 수 있게 저장하는 표. 읽기는 로그인한 모든 직원, 추가·수정·삭제는 지점장만.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. 여러 번 실행해도 안전해요.

create table if not exists center_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'etc',   -- refund / transfer / free / hold / locker / pt / etc (화면에서 정한 분류)
  target text,                            -- 적용 대상 (예: 무료 이용권, 헬스 이용권) - 첫 화면 요약 칸 묶음 기준
  summary text,                           -- 한 줄 설명
  body text,                              -- 본문 (1. 2. 로 시작하는 줄은 단계로, ※ 로 시작하는 줄은 주의 박스로 보여줌)
  chips text[] not null default '{}',     -- 요약 칩 (예: '양도 불가', '환불 조건부')
  pinned boolean not null default false,  -- 중요 규정(맨 위 고정)
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table center_rules enable row level security;
drop policy if exists "규정 조회" on center_rules;
create policy "규정 조회" on center_rules for select using (auth.uid() is not null);
drop policy if exists "규정 등록" on center_rules;
create policy "규정 등록" on center_rules for insert with check (is_manager());
drop policy if exists "규정 수정" on center_rules;
create policy "규정 수정" on center_rules for update using (is_manager());
drop policy if exists "규정 삭제" on center_rules;
create policy "규정 삭제" on center_rules for delete using (is_manager());

-- 처음 화면이 비어 보이지 않게 2건만 넣어둠 (표가 비어 있을 때 한 번만). 첫 번째는 호석님이 알려주신 규정이고,
-- 두 번째는 작성 방법을 보여주는 "예시"예요 - 실제 센터 절차에 맞게 수정하거나 삭제해서 쓰세요.
insert into center_rules (title, category, target, summary, body, chips, pinned)
select * from (values
  ('무료 이용권은 양도도, 환불도 안 돼요', 'free', '무료 이용권', '이벤트 · 체험권 등 무료로 제공된 이용권 공통',
   E'※ 무료로 받은 이용권은 다른 사람에게 양도할 수 없고, 환불도 되지 않아요.\n회원이 양도나 환불을 문의하면 위 내용을 안내해주세요.',
   array['양도 불가','환불 불가'], true),
  ('[예시 - 수정해서 사용] 환불 요청이 들어왔을 때 진행 절차', 'refund', '유료 이용권', '이 내용은 작성 예시예요. 실제 센터 절차로 고쳐주세요',
   E'1. 환불 가능한 이용권인지 먼저 확인해요 (무료 이용권은 환불 불가)\n2. 회원의 결제 내역을 확인해요 (결제일 · 결제수단 · 사용한 기간/횟수)\n3. 지점장에게 보고하고 승인을 받아요\n4. 승인 후 매출 입력에서 환불 건을 등록해요\n※ 위 단계는 예시입니다. 실제 센터 규정에 맞게 수정하거나 삭제해주세요.',
   array['환불 조건부'], false)
) as v(title, category, target, summary, body, chips, pinned)
where not exists (select 1 from center_rules);

notify pgrst, 'reload schema';
