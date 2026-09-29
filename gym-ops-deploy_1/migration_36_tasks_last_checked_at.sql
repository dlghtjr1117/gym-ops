-- 업무 리스트(tasks.html)에 "마지막으로 체크한 날짜" 추가
-- 반복 업무(매일/매주/매월)는 주기가 지나면 화면상 다시 "미체크"로 보이는데, 그동안
-- last_completed_at은 체크 해제할 때마다 null로 초기화되고 있어서 "실제로 마지막에 언제
-- 체크했었는지"는 알 수 없었음. 그래서 체크 해제해도 지워지지 않는 별도 컬럼을 추가함
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

alter table tasks add column if not exists last_checked_at timestamptz;

-- 이미 이번 주기에 체크되어 있는 업무는 last_completed_at 값을 그대로 초기값으로 채워줌
-- (이 컬럼이 생기기 전 기록은 남아있지 않아서, 이후부터 체크하는 시점부터 새로 쌓이기 시작함)
update tasks set last_checked_at = last_completed_at
where last_completed_at is not null and last_checked_at is null;
