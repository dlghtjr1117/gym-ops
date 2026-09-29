-- PT 관리 페이지를 실제 쓰시던 엑셀 시트 구조(주차별 매출기록 / PT 회원관리 / OT관리)에 맞게 보완
-- Supabase SQL Editor에서 새 쿼리로 실행해주세요

-- pt_leads: 상담 건당 "횟수"(몇 회 등록인지)와, OT 진행 상황(예정/이월/미스/완료)을 따로 기록
alter table pt_leads add column if not exists sessions int;              -- 예상/확정 등록 횟수
alter table pt_leads add column if not exists ot_status text             -- OT 진행 상황 (OT관리 섹션에서 사용)
  check (ot_status in ('scheduled','rolled_over','missed','done'));

-- members: 재등록 예상 "횟수"도 금액/확률과 함께 남길 수 있게 추가
alter table members add column if not exists pt_expected_sessions int;
