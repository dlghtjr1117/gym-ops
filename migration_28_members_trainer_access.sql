-- 트레이너도 회원 관리에서 "모든 회원"을 볼 수 있고, 신규 회원을 직접 등록할 수 있도록
-- members 테이블의 조회/등록 RLS를 완화.
-- (기존에는 트레이너는 본인이 담당하는 회원만 조회 가능, 등록은 지점장만 가능했음)
-- 수정/삭제 권한은 기존 그대로 유지: 정보수정은 지점장 또는 담당 트레이너만, 삭제는 지점장만.
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

drop policy if exists "회원 조회" on members;
create policy "회원 조회" on members for select using (auth.uid() is not null);

drop policy if exists "회원 등록/수정" on members;
create policy "회원 등록" on members for insert with check (auth.uid() is not null);
