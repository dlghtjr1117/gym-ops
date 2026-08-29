# 센터 매출 관리 (gym-ops)

호석님(지점장)의 헬스장 1개 지점 운영을 위한 회원·매출·업무 관리 웹앱입니다.
**이 문서는 대화 기록이 사라져도 새로운 Claude 세션이 이 프로젝트를 곧바로 이어받을 수 있도록 만든 인수인계 문서입니다.**
새 세션에서 이어서 개발할 때는, 이 폴더(zip을 풀어놓은 것) 전체를 업로드하고 "이 프로젝트 README부터 읽고 이어서 개발해줘"라고 요청하면 됩니다.

## 이게 뭔가요

- 프론트엔드: 빌드 과정 없는 순수 HTML/CSS/JS (프레임워크·번들러 없음)
- 백엔드: Supabase (Postgres + Auth + REST API). SDK를 설치하지 않고 `fetch()`로 REST API(PostgREST)를 직접 호출합니다.
- 배포: Vercel에 **드래그 앤 드롭**으로 zip을 올리는 수동 배포 방식 (git 연동 자동배포 아님). 코드를 고칠 때마다 새 zip을 만들어 Vercel 대시보드에서 다시 업로드해야 반영됩니다.
- 권한: Supabase RLS(Row Level Security)로 지점장/트레이너 권한을 서버(DB)단에서 강제합니다. `is_manager()` 함수로 지점장 여부를 판별.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `config.js` | Supabase URL/anon key (이미 값이 들어있음, 재발급 필요 없으면 그대로 사용) |
| `auth.js` | 로그인/로그아웃/토큰 자동 갱신 (`getValidAccessToken`), `getMyProfile()` |
| `data.js` | 모든 화면이 공유하는 데이터 함수 모음 (회원/매출/TM/업무/상품/백업 등 API 호출 전부 여기 있음) |
| `style.css` | 공용 스타일 (전부 순수 CSS, 외부 CSS 프레임워크 없음) |
| `index.html`, `login.html`, `signup.html` | 로그인/회원가입 |
| `home.html` | 로그인 직후 첫 화면. 자주 쓰는 메뉴 아이콘 + 지점장 전용 "데이터 백업" 버튼 |
| `dashboard.html` | 대시보드: 만료 임박 현황, 일간/주간/월간 매출 보고, 상품별 재등록 현황, 최근 매출(페이지네이션) |
| `members.html` | 회원 목록(검색+15개씩 페이지네이션) + 회원 상세 모달(정보수정, 장바구니 방식 이용권 판매) + 엑셀 일괄 등록/업데이트 |
| `sales.html` | 매출 직접 등록 폼 + 최근 매출 내역(삭제는 지점장 전용) |
| `expiry.html` | 만료 예정·만료된 회원 + TM(연락) 상태 관리 (카테고리 탭 + 15개씩 페이지네이션) |
| `tasks.html` | 담당자별 업무 리스트 (반복 업무 지원, 15개씩 페이지네이션) |
| `products.html` | 이용권 상품(가격표) 관리, 지점장 전용 등록/수정/비활성화 |
| `schema.sql` | 최초 DB 스키마 (테이블 5개: profiles/members/sales/tm_logs/tasks + RLS) |
| `migration_2~15_*.sql` | 이후 추가된 기능들의 마이그레이션. **번호 순서대로 전부 실행되어 있어야** 코드가 정상 동작함 |
| `seed_products.sql` | 이용권 상품 초기 데이터 (마이그레이션 아님, 1회성 데이터 입력용) |

## 데이터베이스 마이그레이션 이력 (순서대로)

Supabase SQL Editor에서 **번호 순서대로** 실행되어 있어야 합니다. 새 세션에서 스키마 상태를 파악하려면
Supabase 대시보드 → Table Editor에서 실제 테이블/컬럼을 확인하거나, 사용자에게 "지금까지 마이그레이션 다 실행하셨나요?"를 먼저 확인하세요.

1. `schema.sql` — 기본 5개 테이블 + RLS
2. `migration_2_add_rolled_over.sql` — TM 상태에 '이월' 추가
3. `migration_3_add_member_fields.sql` — 회원 성별/생일 등 필드 추가
4. `migration_4_link_sales_tm.sql` — 매출-TM 연결
5. `migration_5_delete_and_cleanup.sql` — 회원 삭제 관련 정리
6. `migration_6_tm_status_update.sql` — TM 상태 갱신 관련
7. `migration_7_tm_checked.sql` — 회원별 "확인함" 체크 필드
8. `migration_8_tm_status_no_answer.sql` — TM 상태에 '미응답' 추가
9. `migration_9_tm_logs_category.sql` — TM 기록에 카테고리(헬스/PT/그룹PT 등) 추가
10. `migration_10_tasks_self_assign.sql` — 트레이너 본인 업무 등록 허용
11. `migration_11_checklist_items.sql` — 체크리스트/청소 관련
12. `migration_12_tasks_repeat.sql` — 업무 반복(매일/매주) 기능
13. `migration_13_products.sql` — **이용권 상품 테이블** 신설 (products) + sales.product_id 연결
14. `migration_14_sales_payment_method.sql` — 매출에 결제수단(카드/현금/계좌이체) 추가
15. `migration_15_sales_delete.sql` — 매출 삭제 권한(지점장 전용) 추가

## 지금까지 구현된 주요 기능

- 로그인/회원가입, 지점장·트레이너 권한 분리 (RLS)
- 회원 관리: 검색, 등록/수정/삭제, 엑셀 일괄 업로드(기존 타 프로그램 양식 자동 인식 + 간단 양식)
- 이용권 판매: 비플 참고한 장바구니 방식 (종류선택 → 담기 → 결제(담당자/결제수단/날짜별 상세설정) → 등록)
- 이용권 상품(가격표) 관리 (지점장 전용)
- 매출 입력/조회/삭제, 결제수단 기록
- 만료 예정·만료 회원 TM(연락) 관리, 카테고리별 필터
- 업무 리스트 (담당자 지정, 반복 업무, 완료 체크)
- 대시보드: 만료 임박 현황, 재등록 확률, 일간/주간/월간 매출 보고(총매출/FC매출/PT총매출 카드), 상품별 재등록 현황
- 만료회원·TM 페이지에도 대시보드와 동일한 "헬스이용권·그룹PT 만료 임박 인원 / 이번 달 재등록 확률" 요약 카드 표시 (카드를 누르면 목록이 해당 상품으로 필터됨)
- 홈 화면 (자주 쓰는 메뉴 아이콘 + 지점장 전용 전체 데이터 백업 다운로드)
- 표(회원 목록/만료회원·TM/업무)는 15개씩 페이지네이션, 칸 너비·행 높이 고정(내용 길이에 따라 흔들리지 않음)

## 아직 안 만든 것 / 예정

- **스케줄러(예약 캘린더)** — 사용자가 명시적으로 "나중에 만들 예정"이라고 보류함. 홈 화면에 "준비중" 배지로 자리만 잡아둠 (`home.html`의 `#tileScheduler`)
- 데이터 백업 자동화 — 현재는 홈 화면에서 수동으로 버튼을 눌러 엑셀 백업. 데이터가 많아지면 주기적 자동 백업으로 발전시킬 예정 (사용자가 원할 때)
- 모바일 앱 연동 — 사용자가 "나중에 앱 개발되면 홈 화면을 앱과 연동" 언급함. 현재는 반응형 웹만 지원

## 배포 방법 (Vercel 드래그 앤 드롭)

1. 이 폴더 전체를 zip으로 압축
2. Vercel 대시보드 → 해당 프로젝트 → zip을 드래그 앤 드롭으로 업로드하면 재배포됨
3. git 연동이 아니므로, **코드를 고칠 때마다 이 과정을 반복**해야 실제 사이트에 반영됨
4. DB 스키마가 바뀌는 변경이면 코드 배포와 별개로 Supabase SQL Editor에서 해당 migration_*.sql을 먼저(또는 같이) 실행해야 함

## 사용자(호석님) 관련 참고사항

- 지점장, 비개발자. Vercel/Supabase SQL Editor는 안내받은 대로 그대로 따라 할 수 있음
- UI/UX 참고 기준으로 "비플(다른 헬스장 관리 프로그램)" 화면을 자주 캡처해서 보여주고 비슷하게 구현해달라고 요청하는 편
- 기능을 만들면 단계별로 스크린샷을 보여달라고 요청하는 경우가 많음 (Playwright로 로컬 렌더링 후 스크린샷 캡처하는 방식 사용 중)
- 변경할 때마다: 코드 수정 → `node --check`로 문법 확인 → 로컬 정적서버(`python3 -m http.server`)+Playwright로 스크린샷 검증 → git commit → zip 재생성 → SendUserFile로 zip과 관련 migration_*.sql, 스크린샷을 함께 전달 → 사용자가 SQL 실행 + Vercel 재배포

## 새 세션에서 이어받을 때 체크리스트

1. 이 README와 `schema.sql` + `migration_*.sql` 전부를 읽고 현재 DB 구조를 파악
2. 각 html 파일의 `<script>`를 읽고 현재 UI/기능 상태 파악 (특히 `data.js`가 공용 함수 허브)
3. 사용자에게 "지금까지 안내드린 migration 파일들을 전부 Supabase에서 실행하셨는지" 확인
4. 이후 작업은 기존 코드 스타일(주석은 한국어로 "왜 이렇게 했는지" 설명 포함, 커밋 메시지도 한국어)을 그대로 따라가면 됨
