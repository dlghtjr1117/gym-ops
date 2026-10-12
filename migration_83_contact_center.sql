-- 📞 연락 센터 (신규상담 + 만료회원·TM + 그룹PT 전환TM을 한 화면으로 합친 통합 화면) 용 변경.
--
-- 핵심은 "다시 연락할 날짜(next_contact_date)" 한 칸을 세 곳에 추가하는 것뿐이에요.
--   - 신규상담·워크인 (walkin_consultations)
--   - 만료회원 TM 기록 (tm_logs)
--   - 그룹PT 전환TM 기록 (group_pt_retention_logs)
-- 고민중 처리하면서 "3일 뒤"를 고르면 그 날짜가 여기 저장되고, 그 날이 되면 연락 센터의
-- "일일업무"에 자동으로 올라와요.
--
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요. 여러 번 실행해도 안전해요.

alter table if exists walkin_consultations add column if not exists next_contact_date date;
alter table if exists tm_logs add column if not exists next_contact_date date;
alter table if exists group_pt_retention_logs add column if not exists next_contact_date date;

create index if not exists walkin_consultations_next_contact_idx on walkin_consultations (next_contact_date);
create index if not exists tm_logs_next_contact_idx on tm_logs (next_contact_date);

notify pgrst, 'reload schema';
