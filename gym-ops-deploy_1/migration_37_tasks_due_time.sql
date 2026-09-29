-- 업무 리스트(tasks.html)에 "시간" 지정 추가
-- "10시 회의", "오후 3시 OO쌤 미팅"처럼 하루 중 특정 시각이 있는 일정을 등록할 수 있도록
-- due_time(시:분) 컬럼을 추가함. 반복 없음/매일/매주/매월 어떤 설정과도 같이 쓸 수 있음
-- (예: "매주 화요일 오후 3시"는 repeat_type=weekly + repeat_weekday=2 + due_time=15:00)
-- 나중에 카카오톡 "몇 분 전 알림" 기능을 붙일 때 이 시간을 기준으로 사용할 예정
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table tasks add column if not exists due_time time;
