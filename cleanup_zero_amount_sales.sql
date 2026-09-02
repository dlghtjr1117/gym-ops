-- 이번에 고친 "0원은 매출로 안 남기기" 기능은 "앞으로 새로 등록하는 것"부터만 적용되고,
-- 이미 등록되어 있던 과거 0원 매출은 자동으로 지워지지 않습니다. 이 SQL로 한 번에 정리하세요.
--
-- 안전하게 2단계로 나눴습니다. 먼저 1번(조회)만 실행해서 몇 건이 지워질지 확인하시고,
-- 이상 없으면 2번(삭제)을 실행하세요.
--
-- 참고: 매출만 삭제되는 거라 회원의 이용권 종목·만료일·PT 잔여횟수 등은 그대로 남아있습니다
-- (원래도 회원 정보 저장과 매출 기록은 서로 다른 기록이라, 매출을 지워도 회원 정보는 안 바뀝니다).

-- 1) 먼저 조회: 몇 건이 0원인지, 어떤 회원들인지 확인
select s.id, s.sale_date, m.name as 회원명, s.category, s.amount, s.memo
from sales s
left join members m on m.id = s.member_id
where s.amount = 0
order by s.sale_date desc;

-- 2) 확인했으면 아래 삭제문을 실행하세요 (위 조회 결과와 똑같은 조건입니다)
-- delete from sales where amount = 0;
