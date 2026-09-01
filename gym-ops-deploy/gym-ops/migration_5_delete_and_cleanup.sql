-- 5) 삭제 권한(RLS) 추가 + 예전에 잘못 들어간 데이터 정리
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요
-- (아래 update문 2개는 몇 번을 실행해도 안전합니다. 이미 정리된 번호는 그대로 유지돼요)

-- 지점장만 삭제 가능하도록 삭제 권한 추가 (지금까지는 삭제 권한이 아예 없었어요)
create policy "회원 삭제" on members for delete using (is_manager());
create policy "매출 삭제" on sales for delete using (is_manager());
create policy "TM기록 삭제" on tm_logs for delete using (is_manager());

-- 전화번호 표기를 숫자만 남겨서 통일 (하이픈/공백 표기 차이로 엑셀을 다시 올릴 때마다
-- 같은 사람이 새 회원으로 중복 등록되는 문제를 막기 위함)
update members
set phone = regexp_replace(phone, '[^0-9]', '', 'g')
where phone is not null;

-- 엑셀에서 숫자 형식 셀로 저장돼 맨 앞자리 0이 사라진 전화번호 보정 (010... -> 10... 이 된 경우)
update members
set phone = '0' || phone
where phone is not null and length(phone) = 10 and phone not like '0%';

-- 아래는 예전에 잘못 인식된(엉뚱한 값이 이름으로 들어간) 회원 행을 찾기 위한 확인용 조회입니다.
-- 먼저 이 결과를 눈으로 확인한 뒤, 정말 잘못된 행이라고 판단되면
-- 맨 아래 delete문의 주석(--)을 지우고 실행해서 지워주세요. (되돌릴 수 없으니 신중하게 확인하세요)
select id, name, phone, membership_type, membership_end_date, created_at
from members
order by created_at asc
limit 200;

-- 예: 전화번호가 비어있는 행만 지우고 싶다면 (예전 잘못된 업로드가 전화번호를 못 읽었을 가능성이 높은 경우)
-- delete from members where phone is null;

-- 예: 이름이 비어있는 행만 지우고 싶다면
-- delete from members where name is null or name = '';

-- 특정 회원만 지우고 싶다면 (위 select 결과에서 id 복사해서 사용)
-- delete from members where id = '여기에-회원-id-붙여넣기';
