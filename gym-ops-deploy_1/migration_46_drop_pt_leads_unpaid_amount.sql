-- migration_45에서 추가했던 pt_leads.unpaid_amount 컬럼을 되돌리는 변경.
-- "미납금"을 별도 숫자 칸으로 만들었었는데, 실제로 원하신 건 "분납 잔금을 오늘 받았다"는 것을
-- 확정 매출에 정상적으로 잡히게 기록하는 용도였음 - 그래서 별도 칸 대신 "유형"(source)에
-- "미납금" 값 하나를 추가하는 방식으로 다시 만들었고(코드 변경만, DB는 그대로 source 컬럼 재사용),
-- migration_45로 추가했던 이 컬럼은 이제 안 쓰여서 정리함.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. (migration_45를 실행 안 하셨다면 이 파일은
-- 실행하지 않으셔도 돼요 - 어차피 없는 컬럼을 지우는 것뿐이라 실행해도 무해하긴 합니다.)

alter table pt_leads drop column if exists unpaid_amount;
