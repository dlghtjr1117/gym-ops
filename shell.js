/* shell.js — v4 디자인: 왼쪽 사이드바 + 선 아이콘 + 메뉴 검색(⌘K / Ctrl+K)
   - 각 페이지의 기존 상단 메뉴(.topnav a)를 읽어서 사이드바로 다시 그려줌 → 메뉴 목록은 계속 각 페이지에 있는 그대로,
     권한별 숨김(auth.js applyRoleNav)도 그대로 동작(사이드바 링크도 같은 href라 같이 숨겨짐).
   - 페이지 본문/스크립트는 하나도 안 건드림(사이드바는 position:fixed, 본문은 padding-left로 비켜줌).
   - 아이콘은 Lucide 스타일 선 아이콘을 직접 넣어둠(외부 로딩 없음 → 오프라인에서도 동일).
   - 문제가 생겨도 기존 상단 메뉴가 그대로 남아있도록, 모든 작업은 try/catch 안에서 하고 성공했을 때만 body에 has-shell 클래스를 붙임. */
(function () {
  'use strict';
  var P = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5v-.5a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6v.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M21.5 20.5v-.5a6 6 0 0 0-4-5.6"/>',
    phone: '<path d="M5 4h3.5l2 5-2.3 1.4a11 11 0 0 0 5.4 5.4L15 13.5l5 2V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    mega: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M18 6a8 8 0 0 1 0 12"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>',
    dumb: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
    cal: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    tasks: '<path d="M9 11.5 11.5 14 16 9"/><rect x="4" y="3" width="16" height="18" rx="2.5"/>',
    pack: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    book: '<path d="M2 5h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 5h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    userCog: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5v-.5a6 6 0 0 1 6-6h1.5"/><circle cx="18" cy="17" r="2.5"/><path d="M18 12.5v1.5M18 20v1.5M13.6 14.8l1.3.8M21.1 19.4l1.3.8M13.6 19.2l1.3-.8M21.1 14.6l1.3-.8"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M21 10H15a2 2 0 0 0 0 4h6z"/>',
    trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/>',
    bar: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V7M18 17v-8"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'
  };
  // href → [아이콘, 그룹]. 모르는 페이지는 '기타'로 들어감.
  var MAP = {
    'home.html': ['home', ''], 'dashboard.html': ['dash', ''],
    'members.html': ['users', '회원'], 'contact-center.html': ['phone', '회원'], 'expiry.html': ['repeat', '회원'], 'consultations.html': ['msg', '회원'],
    'sales.html': ['card', '매출'], 'center-sales.html': ['wallet', '매출'], 'marketing.html': ['mega', '매출'], 'products.html': ['tag', '매출'], 'metrics.html': ['bar', '매출'],
    'pt.html': ['dumb', '운영'], 'ot.html': ['users', '운영'], 'schedule.html': ['cal', '운영'], 'group-pt-attendance.html': ['users', '운영'], 'group-pt.html': ['users', '운영'], 'tasks.html': ['tasks', '운영'], 'supplies.html': ['pack', '운영'],
    'meetings.html': ['mic', '기록'], 'rules.html': ['book', '기록'], 'suggestions.html': ['msg', '기록'],
    'staff.html': ['userCog', '관리'], 'payroll.html': ['file', '관리'], 'accounts.html': ['key', '관리'], 'bodycodi-sync.html': ['link', '관리']
  };
  var GROUP_ORDER = ['', '회원', '매출', '운영', '기록', '관리', '기타'];

  function icon(n, cls) { return '<svg class="i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || P.file) + '</svg>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function stripEmoji(t) { return t.replace(/^[^A-Za-z0-9\uAC00-\uD7AF]+/, '').trim(); }
  function hrefKey(h) { return (h || '').split('?')[0].split('#')[0].replace(/^\.\//, ''); }

  function build() {
    var topbar = document.querySelector('.topbar');
    var topnav = document.querySelector('.topbar .topnav');
    if (!topbar || !topnav || document.getElementById('sb')) return false;

    var links = [].slice.call(topnav.querySelectorAll('a[href]')).map(function (a) {
      var key = hrefKey(a.getAttribute('href'));
      var m = MAP[key] || ['file', '기타'];
      return { href: a.getAttribute('href'), key: key, label: stripEmoji(a.textContent.trim()) || a.textContent.trim(), icon: m[0], group: m[1], active: a.classList.contains('active') };
    });
    if (!links.length) return false;

    var groups = {};
    links.forEach(function (l) { (groups[l.group] = groups[l.group] || []).push(l); });

    var brandEl = topbar.querySelector('.brand');
    var title = (document.title.split(' - ')[1] || document.title || '').trim();

    var navHtml = GROUP_ORDER.filter(function (g) { return groups[g]; }).map(function (g) {
      return '<div class="sb-grp">' + (g ? '<h6>' + g + '</h6>' : '') + groups[g].map(function (l) {
        return '<a class="sb-item' + (l.active ? ' on' : '') + '" href="' + esc(l.href) + '">' + icon(l.icon) + '<span>' + esc(l.label) + '</span></a>';
      }).join('') + '</div>';
    }).join('');

    var aside = document.createElement('aside');
    aside.id = 'sb';
    aside.className = 'sb';
    aside.innerHTML =
      '<div class="sb-brand"><span class="sb-logo">C</span><div><b>센터 매출 관리</b></div></div>' +
      '<button type="button" class="sb-search" id="sbSearch">' + icon('search', 'sm') + '<span>메뉴 검색</span><kbd id="sbKbd">Ctrl K</kbd></button>' +
      '<nav class="sb-nav">' + navHtml + '</nav>' +
      '<div class="sb-me"><div class="sb-av" id="sbAv">–</div><div class="sb-who"><b id="sbName">로딩 중…</b></div>' +
      '<button type="button" class="sb-out" id="sbOut" title="로그아웃" aria-label="로그아웃">' + icon('logout', 'sm') + '</button></div>';
    var scrim = document.createElement('div');
    scrim.className = 'sb-scrim'; scrim.id = 'sbScrim';
    document.body.insertBefore(scrim, document.body.firstChild);
    document.body.insertBefore(aside, document.body.firstChild);

    // 상단 바: 로고 자리에 햄버거(모바일) + 현재 페이지 이름
    if (brandEl) {
      brandEl.innerHTML = '<button type="button" class="sb-burger" id="sbBurger" aria-label="메뉴 열기">' + icon('menu') + '</button><span class="page-title">' + esc(title) + '</span>';
    }
    document.body.classList.add('has-shell');

    function openSb(v) { aside.classList.toggle('open', v); scrim.classList.toggle('open', v); }
    var burger = document.getElementById('sbBurger');
    if (burger) burger.addEventListener('click', function () { openSb(!aside.classList.contains('open')); });
    scrim.addEventListener('click', function () { openSb(false); });
    aside.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) openSb(false); });

    // 사이드바 하단 사용자 카드: 기존 #roleBadge 글자를 그대로 따라감 + 로그아웃은 기존 버튼을 눌러줌
    var rb = document.getElementById('roleBadge');
    function syncMe() {
      if (!rb) return;
      var t = (rb.textContent || '').trim();
      document.getElementById('sbName').textContent = t || '로딩 중…';
      document.getElementById('sbAv').textContent = t && t !== '로딩 중...' ? t.charAt(0) : '–';
    }
    if (rb) { syncMe(); try { new MutationObserver(syncMe).observe(rb, { childList: true, characterData: true, subtree: true }); } catch (e) {} }
    document.getElementById('sbOut').addEventListener('click', function () { var b = document.getElementById('logoutBtn'); if (b) b.click(); });

    // 메뉴 검색 (Ctrl/⌘ + K, 또는 검색 칸 클릭)
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    document.getElementById('sbKbd').textContent = isMac ? '⌘ K' : 'Ctrl K';
    var pal = document.createElement('div');
    pal.className = 'pal'; pal.id = 'pal'; pal.hidden = true;
    pal.innerHTML = '<div class="pal-box" role="dialog" aria-label="메뉴 검색"><div class="pal-in">' + icon('search', 'sm') + '<input id="palQ" type="text" autocomplete="off" placeholder="이동할 메뉴를 입력하세요" /></div><div class="pal-list" id="palList"></div></div>';
    document.body.appendChild(pal);
    var sel = 0, shown = [];
    function visibleLinks() { // 권한 때문에 숨겨진 메뉴는 검색 결과에서도 빼줌
      return links.filter(function (l) {
        var a = aside.querySelector('a[href="' + l.href.replace(/"/g, '\\"') + '"]');
        return a && a.style.display !== 'none';
      });
    }
    function renderPal() {
      var q = document.getElementById('palQ').value.trim().toLowerCase();
      shown = visibleLinks().filter(function (l) { return !q || l.label.toLowerCase().indexOf(q) >= 0; });
      if (sel >= shown.length) sel = 0;
      document.getElementById('palList').innerHTML = shown.length ? shown.map(function (l, i) {
        return '<a class="pal-item' + (i === sel ? ' on' : '') + '" href="' + esc(l.href) + '">' + icon(l.icon) + '<span>' + esc(l.label) + '</span><em>' + (l.group || '바로가기') + '</em></a>';
      }).join('') : '<div class="pal-empty">찾는 메뉴가 없어요</div>';
    }
    function openPal() { pal.hidden = false; sel = 0; var q = document.getElementById('palQ'); q.value = ''; renderPal(); setTimeout(function () { q.focus(); }, 0); }
    function closePal() { pal.hidden = true; }
    document.getElementById('sbSearch').addEventListener('click', openPal);
    pal.addEventListener('click', function (e) { if (e.target === pal) closePal(); });
    document.getElementById('palQ').addEventListener('input', function () { sel = 0; renderPal(); });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); pal.hidden ? openPal() : closePal(); return; }
      if (pal.hidden) return;
      if (e.key === 'Escape') closePal();
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); renderPal(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderPal(); }
      else if (e.key === 'Enter' && shown[sel]) { location.href = shown[sel].href; }
    });
    return true;
  }

  function init() { try { build(); } catch (e) { try { document.body.classList.remove('has-shell'); var s = document.getElementById('sb'); if (s) s.remove(); } catch (_) {} } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
