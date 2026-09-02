-- 업무 리스트(tasks.html)에 "매월" 반복 추가 (일/주만 있던 걸 "매월 ○째 주 ○요일"까지 지원)
-- 예: "매월 마지막 주 수요일" · "매월 첫째 주 화요일"
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table tasks drop constraint if exists tasks_repeat_type_check;
alter table tasks add constraint tasks_repeat_type_check
  check (repeat_type in ('none', 'daily', 'weekly', 'monthly'));

-- 몇째 주인지: 1~4 = 첫째~넷째 주, -1 = 마지막 주(매달 4주/5주가 왔다갔다 하는 달에도 항상
-- "그 달의 마지막 ○요일"을 정확히 가리키도록 5 대신 -1로 표현함)
alter table tasks add column if not exists repeat_week_ordinal int
  check (repeat_week_ordinal in (1, 2, 3, 4, -1));
