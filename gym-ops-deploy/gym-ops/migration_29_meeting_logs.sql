-- 미팅 기록일지: 직원 회의(지점장-트레이너) 내용을 기록하는 새 화면(meetings.html)을 위한 테이블.
-- 수기로 직접 입력할 수도 있고, "AI 녹음" 기능으로 녹음한 음성을 자동으로 전사(transcript)·요약(summary)해서
-- 채워 넣을 수도 있음 (전사/요약은 Supabase Edge Function을 거쳐 OpenAI를 호출해서 만들어짐 - 별도 설정 필요).
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

create table meeting_logs (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id),
  meeting_date date not null default current_date,
  title text not null,
  attendees text,          -- 참석자 (쉼표로 구분한 이름 등 자유 입력)
  memo text,                -- 직접 남기는 메모 (AI 요약과 별개로 자유롭게 적는 칸)
  transcript text,          -- AI 녹음 기능으로 만들어진 전체 대화 전사 텍스트
  summary text,             -- AI가 만든 요약(핵심 내용/결정사항/할 일)
  created_at timestamptz not null default now()
);

alter table meeting_logs enable row level security;

-- 조회: 직원 회의 기록이라 지점장·트레이너 누구나 전체를 볼 수 있게 함 (특정 담당자 것만 보이는 회원/매출과는 다름)
create policy "미팅 기록 조회" on meeting_logs for select using (auth.uid() is not null);
-- 등록: 로그인한 사람이면 누구나 작성 가능. 단 본인 명의로만 작성 가능 (다른 사람 이름으로 등록 방지)
create policy "미팅 기록 등록" on meeting_logs for insert with check (author_id = auth.uid());
-- 수정/삭제: 작성자 본인 또는 지점장만
create policy "미팅 기록 수정" on meeting_logs for update using (is_manager() or author_id = auth.uid());
create policy "미팅 기록 삭제" on meeting_logs for delete using (is_manager() or author_id = auth.uid());
