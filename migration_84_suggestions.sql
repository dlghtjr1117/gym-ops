-- 💌 마음의 소리함 (회원용 건의함)
--
-- 엘리베이터 등에 붙인 QR을 휴대폰으로 찍으면 로그인 없이 "건의사항 적는 칸"만 나오는 화면(suggest.html)이 열리고,
-- 전송하면 아래 suggestions 표에 쌓여서 지점장이 "마음의 소리함" 관리 화면(suggestions.html)에서 읽어요.
--
-- - 회원(로그인 안 한 사람)은 아래 submit_suggestion() 함수로 "작성"만 할 수 있고, 표를 직접 읽거나 고칠 수는 없어요.
-- - 읽기 · 확인 처리 · 메모 · 삭제는 지점장만 가능해요. (직원 관리 등과 같은 is_manager 기준)
-- - 누가 썼는지(이름·IP 등)는 따로 저장하지 않아요. 답변이 필요한 분이 직접 적은 연락처만 저장돼요.
--
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. 여러 번 실행해도 안전해요.

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  content text not null check (char_length(content) between 1 and 2000),
  contact text,                                     -- 회원이 적은 연락처/이름(선택, 답변 받고 싶을 때만)
  status text not null default 'new' check (status in ('new', 'read', 'done')),
  admin_memo text,                                  -- 지점장이 남기는 처리 메모
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create index if not exists suggestions_created_idx on suggestions (created_at desc);
create index if not exists suggestions_status_idx on suggestions (status);

alter table suggestions enable row level security;

drop policy if exists "마음의소리 조회" on suggestions;
create policy "마음의소리 조회" on suggestions for select using (is_manager());
drop policy if exists "마음의소리 수정" on suggestions;
create policy "마음의소리 수정" on suggestions for update using (is_manager());
drop policy if exists "마음의소리 삭제" on suggestions;
create policy "마음의소리 삭제" on suggestions for delete using (is_manager());
-- insert 정책은 일부러 없음 - 아래 함수로만 작성 가능

-- 로그인 없이(anon 키) 호출되는 작성 함수. 길이 검사 + 도배 방지(1분에 12건 이상 들어오면 잠시 막음).
create or replace function submit_suggestion(p_content text, p_contact text default null)
returns table(ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content text := btrim(coalesce(p_content, ''));
  v_contact text := nullif(btrim(coalesce(p_contact, '')), '');
begin
  if v_content = '' then
    return query select false, '내용을 입력해주세요.';
    return;
  end if;
  if char_length(v_content) > 2000 then
    return query select false, '내용이 너무 길어요. 2000자 이내로 줄여주세요.';
    return;
  end if;
  if v_contact is not null and char_length(v_contact) > 100 then
    v_contact := left(v_contact, 100);
  end if;
  if (select count(*) from suggestions where created_at > now() - interval '1 minute') >= 12 then
    return query select false, '지금 접속이 몰려서 잠시 후 다시 시도해주세요.';
    return;
  end if;

  insert into suggestions (content, contact) values (v_content, v_contact);
  return query select true, '소중한 의견 감사합니다. 지점장에게 전달됐어요.';
end;
$$;

grant execute on function submit_suggestion(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
