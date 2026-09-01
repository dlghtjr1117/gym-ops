-- 매출 삭제 허용 (지금까지는 등록/조회만 가능하고 삭제 정책이 없어서 잘못 입력한 매출을 못 지웠음)
-- 회원 삭제 때와 마찬가지로, 삭제는 지점장만 할 수 있게 제한함
create policy "매출 삭제" on sales for delete using (is_manager());
