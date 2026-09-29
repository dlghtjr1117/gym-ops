-- ============================================
-- 센터 매출 관리 앱 - 데이터베이스 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 전체 붙여넣고 Run
-- ============================================

-- 1) 직원 프로필 (로그인 계정 = 지점장 or 트레이너)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'trainer' check (role in ('manager','trainer')),
  phone text,
  created_at timestamptz default now()
);

-- 회원가입하면 자동으로 profiles 행 생성 (기본 role: trainer, 지점장은 나중에 수동 승격)
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), 'trainer');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2) 회원(고객)
create table members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  gender text,
  birth_date date,
  join_date date default current_date,
  membership_type text,           -- 이용권 종목, 예: '회원권 3개월'
  membership_end_date date,       -- 이용권 만료일
  group_pt_type text,             -- 그룹PT 종목, 예: '필라테스', '크로스핏'
  group_pt_end_date date,         -- 그룹PT 만료일
  pt_remaining_sessions int,      -- 개인PT 잔여 횟수
  pt_end_date date,               -- 개인PT 만료 예정일
  locker_end_date date,           -- 락커 이용 만료일
  workout_clothes_end_date date,  -- 운동복 대여 만료일
  assigned_trainer_id uuid references profiles(id),
  status text default 'active' check (status in ('active','expired','left')),
  created_at timestamptz default now()
);

-- 3) 매출 내역
create table sales (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id),
  staff_id uuid references profiles(id),
  category text not null check (category in ('membership_new','membership_renewal','pt_new','pt_renewal','group_pt_new','group_pt_renewal','locker','clothes')),
  amount numeric not null,
  sale_date date default current_date,
  memo text,
  created_at timestamptz default now()
);

-- 4) 만료 회원 TM(전화연락) 기록
create table tm_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members(id) not null,
  staff_id uuid references profiles(id),
  contact_date date default current_date,
  status text not null default 'not_contacted' check (status in ('not_contacted','in_progress','renewed','rolled_over','declined')),
  memo text,
  created_at timestamptz default now()
);

-- 5) 트레이너별 업무 리스트
create table tasks (
  id uuid primary key default gen_random_uuid(),
  assignee_id uuid references profiles(id) not null,
  member_id uuid references members(id),
  title text not null,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  due_date date,
  created_at timestamptz default now()
);

-- ============================================
-- 권한 설정 (RLS: 지점장은 전체, 트레이너는 본인 관련 데이터만)
-- ============================================
alter table profiles enable row level security;
alter table members enable row level security;
alter table sales enable row level security;
alter table tm_logs enable row level security;
alter table tasks enable row level security;

-- 현재 로그인한 사람이 지점장인지 확인하는 함수
create function public.is_manager()
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'manager'
  );
$$ language sql security definer stable;

-- profiles: 본인 정보는 항상 조회 가능, 지점장은 전체 조회 가능
create policy "본인 프로필 조회" on profiles for select using (id = auth.uid() or is_manager());
create policy "본인 프로필 수정" on profiles for update using (id = auth.uid());

-- members: 지점장은 전체, 트레이너는 담당 회원만
create policy "회원 조회" on members for select using (is_manager() or assigned_trainer_id = auth.uid());
create policy "회원 등록/수정" on members for insert with check (is_manager());
create policy "회원 정보수정" on members for update using (is_manager() or assigned_trainer_id = auth.uid());

-- sales: 지점장은 전체, 트레이너는 본인이 올린 매출만
create policy "매출 조회" on sales for select using (is_manager() or staff_id = auth.uid());
create policy "매출 등록" on sales for insert with check (is_manager() or staff_id = auth.uid());

-- tm_logs: 지점장은 전체, 트레이너는 본인 담당만
create policy "TM기록 조회" on tm_logs for select using (is_manager() or staff_id = auth.uid());
create policy "TM기록 등록/수정" on tm_logs for insert with check (is_manager() or staff_id = auth.uid());
create policy "TM기록 수정" on tm_logs for update using (is_manager() or staff_id = auth.uid());

-- tasks: 지점장은 전체, 트레이너는 본인 업무만
create policy "업무 조회" on tasks for select using (is_manager() or assignee_id = auth.uid());
create policy "업무 등록" on tasks for insert with check (is_manager());
create policy "업무 상태변경" on tasks for update using (is_manager() or assignee_id = auth.uid());
