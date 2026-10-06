[자동 통화 기록함 - 신규상담 페이지로 이동 버전]

1) Supabase SQL Editor에서 migration_72_call_events.sql 실행
   - 전에 이미 한 번 실행하셨어도 괜찮아요. 이번 버전은 call_events 테이블에
     consult_id 컬럼을 추가하는 부분만 새로 들어있고, 나머지는 전부 "이미
     있으면 건너뛰기" 방식이라 다시 실행해도 안전해요.

2) GitHub 저장소 페이지 -> Add file -> Upload files 에서
   이 zip 안의 *.html, *.js, *.css 파일을 전부 드래그해서 올리고 Commit changes
   (migration_72_call_events.sql은 올리지 마세요 - 그건 Supabase 전용 파일이에요)

3) 직원 관리(staff.html) 페이지에서 센터폰용 토큰 발급 + Tasker 설정
   (아직 안 하셨다면)

4) 전화 테스트 후 "신규상담" 페이지 상단에 자동 통화 기록함에 떴는지 확인
   - 이전 버전과 달리 이제 "만료회원·TM" 페이지가 아니라 "신규상담" 페이지
     상단에 떠요.
