(function () {
  const SHEET_ID = '1ddTpJF2KydGJweNh-iQFKm0OxNissNW7ypJOKU91UEY';
  const GOOGLE_CLIENT_ID = '396260418392-2l1uc7f9e8tf8gggpnminjd1ldmdl8nb.apps.googleusercontent.com';
  let googleAccessToken = null;
  let sheetTabName = null;

  let allRiders = [];
  let filtered = [];
  let currentMode = 'bookings';

  const $ = (id) => document.getElementById(id);
  let sheetTabs = null;

  async function fetchSheetValues(force, requestedTabName) {
    if (!googleAccessToken) throw new Error('سجّل الدخول باستخدام Google أولًا');

    const headers = { Authorization: 'Bearer ' + googleAccessToken };
    const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID;

    if (!sheetTabs || force) {
      const mr = await fetch(base + '?fields=sheets.properties.title', { headers });
      if (!mr.ok) throw new Error('تعذر الوصول للشيت: HTTP ' + mr.status);
      const meta = await mr.json();
      sheetTabs = (meta.sheets || []).map(x => x.properties.title);
    }

    let selectedTabName;
    if (requestedTabName) {
      selectedTabName = sheetTabs.find(
        name => String(name).trim() === requestedTabName
      );
      if (!selectedTabName) {
        throw new Error('لم يتم العثور على ورقة باسم: ' + requestedTabName);
      }
    } else {
      if (!sheetTabName || force) sheetTabName = sheetTabs[0];
      selectedTabName = sheetTabName;
    }

    if (!selectedTabName) throw new Error('لم يتم العثور على ورقة بيانات');

    const range = "'" + selectedTabName.replace(/'/g, "''") + "'!A:Z";
    const r = await fetch(base + '/values/' + encodeURIComponent(range), { headers });
    if (!r.ok) throw new Error('فشل تحميل الشيت: HTTP ' + r.status);
    return (await r.json()).values || [];
  }

  function rowsToCSV(rows) {
    return rows.map(row => row.map(v =>
      '"' + String(v ?? '').replace(/"/g, '""') + '"'
    ).join(',')).join('\n');
  }


  /* ---------- Auth ---------- */
  function isLoggedIn() {
    return !!localStorage.getItem('alabtal_user');
  }

  function showLogin() {
    $('loginScreen').classList.remove('hidden');
    $('app').classList.add('hidden');
  }

  function prepareSheetPanel() {
    let panel = $('sheetAuthPanel');

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'sheetAuthPanel';
      panel.className = 'google-status';

      const label = document.createElement('span');
      label.id = 'sheetAuthTitle';
      label.className = 'google-status-label';
      panel.appendChild(label);
    }

    const btn = $('googleLoginBtn');
    const msg = $('googleLoginMsg');
    const connected = !!googleAccessToken;
    const label = $('sheetAuthTitle');

    if (btn && btn.parentElement !== panel) panel.appendChild(btn);
    if (msg && msg.parentElement !== panel) panel.appendChild(msg);

    if (label) {
      label.textContent = connected ? 'Google متصل' : 'Google غير متصل';
    }

    if (btn) {
      btn.classList.add('google-connect-compact');
      btn.textContent = connected ? 'متصل ✓' : 'ربط Google';
      btn.hidden = connected;
    }

    if (msg) msg.classList.add('google-status-message');

    panel.classList.toggle('is-connected', connected);

    const actions = document.querySelector('.hdr-actions');
    if (actions && panel.parentElement !== actions) {
      actions.insertBefore(panel, actions.firstChild);
    }

    panel.classList.toggle('hidden', connected);
    panel.style.display = connected ? 'none' : '';
  }

  function showApp() {
    $('loginScreen').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('headerUser').textContent =
      localStorage.getItem('alabtal_user') || '';
    prepareSheetPanel();
    setMode('bookings');
    loadRoster();
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = $('loginUser').value.trim();
    const pass = $('loginPass').value;
    const error = $('loginError');
    const btn = $('loginBtn');

    error.textContent = '';
    if (!user || !pass) {
      error.textContent = 'اكتب اليوزر والباسورد';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'جاري التحقق...';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
      const result = await response.json();

      if (!response.ok || !result.ok) {
        error.textContent =
          result.error || 'اسم المستخدم أو كلمة المرور غير صحيحة';
        return;
      }

      localStorage.setItem('alabtal_user', result.username);
      $('loginPass').value = '';
      showApp();
    } catch (err) {
      error.textContent =
        'تعذر الاتصال بالسيرفر. افتح الصفحة من proxy.py.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'تسجيل الدخول';
    }
  });

  $('logoutBtn').addEventListener('click', async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });
    } catch (e) {}

    localStorage.removeItem('alabtal_user');
    googleAccessToken = null;
    allRiders = [];
    showLogin();
  });

  $('refreshBtn').addEventListener('click', () => {
    if (currentMode === 'live') loadLive(true);
    else if (currentMode === 'roster') loadRoster(true);
  });

  $('roosterOpenBtn').addEventListener('click', () => {
    window.open('https://eg.me.logisticsbackoffice.com/dashboard/rooster/', '_blank', 'noopener,noreferrer');
  });

  /* ---------- Mode navigation (classic top tabs) ---------- */
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    document.querySelectorAll('.mode-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'mode-' + mode);
    });
    if (mode === 'hours') renderWorkHours();
  }

  /* ---------- Sub-tabs UI only (bookings / live) ---------- */
  
  document.querySelectorAll('#regionTabs .region-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#regionTabs .region-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      liveRegion = btn.dataset.region || 'all';
      renderLive();
    });
  });

  document.querySelectorAll('#liveSubTabs .sub-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#liveSubTabs .sub-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });


  /* ---------- CSV / Roster ---------- */
  function splitCSVLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
        continue;
      }
      if (c === ',' && !inQ) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  function detectColumns(headerCols) {
    const h = headerCols.map((x) => String(x || '').trim().toLowerCase());
    const find = (...needles) => {
      for (const n of needles) {
        const i = h.findIndex((c) => c === n || c.includes(n));
        if (i !== -1) return i;
      }
      return -1;
    };
    return {
      id: find('worker id', 'rider id', 'id المندوب', 'workerid'),
      name: find('name', 'rider name', 'اسم المندوب', 'اسم الموظف'),
      phone: find('phone', 'موبايل', 'هاتف', 'تليفون'),
      nationalId: find('national id', 'الرقم القومي', 'قومي'),
      area: find('منطقة العمل', 'area', 'zone', 'الزون'),
      city: find('city', 'المدينة'),
      supervisor: find('اسم المشرف', 'supervisor', 'المشرف'),
      manager: find('مدير المنطقه', 'مدير المنطقة', 'manager'),
      status: find('الحالة', 'status', 'حاله'),
      shiftStart: find('بدايه الشيفت', 'بداية الشيفت', 'shift start', 'shift_start'),
      shiftEnd: find('نهايه الشيفت', 'نهاية الشيفت', 'shift end', 'shift_end'),
      pl3: find('3pl')
    };
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const col = detectColumns(splitCSVLine(lines[0]));
    if (col.id === -1 || col.name === -1) return [];
    const riders = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      const id = (cols[col.id] || '').trim();
      let nameRaw = (cols[col.name] || '').trim();
      if (!id) continue;
      if (!nameRaw) nameRaw = 'Rider ' + id;
      const g = (k) => (col[k] >= 0 ? (cols[col[k]] || '').trim() : '');
      riders.push({
        id,
        name: nameRaw.replace(/\s*_EL ABTAL(_BC)?/gi, '').trim(),
        phone: g('phone'),
        nationalId: g('nationalId'),
        area: g('area') || g('city'),
        city: g('city'),
        supervisor: g('supervisor'),
        manager: g('manager'),
        pl3: g('pl3'),
        status: g('status') || 'Unknown',
        shiftStart: g('shiftStart'),
        shiftEnd: g('shiftEnd')
      });
    }
    return riders;
  }

  function isInactive(status) {
    const s = String(status || '').toLowerCase();
    return s === 'inactive' || s === 'no sp' || s.includes('inactive');
  }

  async function loadRoster(force) {
    if (!googleAccessToken) {
      prepareSheetPanel();
      $('rsLoading').classList.add('hidden');
      $('rsList').innerHTML =
        '<div class="empty-box"><p>اتصال Google غير نشط</p><p>اضغط زر Google لإعادة الاتصال بالشيت.</p></div>';
      return;
    }

    $('rsLoading').classList.remove('hidden');
    $('rsList').innerHTML = '';
    $('rsEmpty').classList.add('hidden');
    try {
      const rows = await fetchSheetValues(!!force);
      allRiders = parseCSV(rowsToCSV(rows));
      // force stat also reflects roster size
      $('stForce').textContent = allRiders.length.toLocaleString('ar-EG');
      buildFilters();
      applyRosterFilters();
      updateRosterStats();
      if (typeof syncBookingsFromLive === "function") syncBookingsFromLive();
    } catch (err) {
      console.error('Roster loading error:', err);
      $('rsList').innerHTML =
        '<div class="empty-box"><p>فشل تحميل الروستر</p><p>' + escapeHtml(err.message || '') + '</p></div>';
    } finally {
      $('rsLoading').classList.add('hidden');
    }
  }

  function updateRosterStats() {
    const total = allRiders.length;
    const active = allRiders.filter((r) => !isInactive(r.status)).length;
    $('rsTotal').textContent = total.toLocaleString('ar-EG');
    $('rsActive').textContent = active.toLocaleString('ar-EG');
    $('rsInactive').textContent = (total - active).toLocaleString('ar-EG');
    $('rsAreas').textContent = new Set(allRiders.map((r) => r.area).filter(Boolean)).size.toLocaleString('ar-EG');
  }

  function buildFilters() {
    const areas = [...new Set(allRiders.map((r) => r.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    const supers = [...new Set(allRiders.map((r) => r.supervisor).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'ar')
    );
    const areaSel = $('rsArea');
    const supSel = $('rsSuper');
    const curA = areaSel.value;
    const curS = supSel.value;
    areaSel.innerHTML =
      '<option value="all">كل المناطق</option>' +
      areas.map((a) => `<option value="${escapeAttr(a)}">${escapeHtml(a)}</option>`).join('');
    supSel.innerHTML =
      '<option value="all">كل المشرفين</option>' +
      supers.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
    if (areas.includes(curA)) areaSel.value = curA;
    if (supers.includes(curS)) supSel.value = curS;
  }

  function applyRosterFilters() {
    const q = ($('rsSearch').value || '').trim().toLowerCase();
    const status = $('rsStatus').value;
    const area = $('rsArea').value;
    const supervisor = $('rsSuper').value;
    filtered = allRiders.filter((r) => {
      if (status === 'active' && isInactive(r.status)) return false;
      if (status === 'inactive' && !isInactive(r.status)) return false;
      if (area !== 'all' && r.area !== area) return false;
      if (supervisor !== 'all' && r.supervisor !== supervisor) return false;
      if (q) {
        const hay = [r.name, r.id, r.phone, r.area, r.supervisor, r.manager, r.nationalId].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    renderRoster();
  }

  function renderRoster() {
    const list = $('rsList');
    $('rsCount').textContent = filtered.length.toLocaleString('ar-EG') + ' نتيجة';
    if (!filtered.length) {
      list.innerHTML = '';
      $('rsEmpty').classList.remove('hidden');
      return;
    }
    $('rsEmpty').classList.add('hidden');
    const show = filtered.slice(0, 250);
    list.innerHTML = show
      .map((r, idx) => {
        const off = isInactive(r.status);
        return `<article class="rider-card ${off ? 'is-inactive' : 'is-active'}" data-i="${idx}">
          <div class="rc-top">
            <h3>${escapeHtml(r.name)}</h3>
            <span class="badge ${off ? 'off' : 'on'}">${escapeHtml(r.status)}</span>
          </div>
          <div class="rc-meta">
            <span>ID: ${escapeHtml(r.id)}</span>
            ${r.phone ? `<span>${escapeHtml(r.phone)}</span>` : ''}
            ${r.area ? `<span>${escapeHtml(r.area)}</span>` : ''}
            ${r.supervisor ? `<span>${escapeHtml(r.supervisor)}</span>` : ''}
          </div>
        </article>`;
      })
      .join('');
    if (filtered.length > 250) {
      list.innerHTML +=
        '<div class="empty-box"><p>عرض 250 من ' + filtered.length + ' — استخدم البحث</p></div>';
    }
    list.querySelectorAll('.rider-card').forEach((card) => {
      card.addEventListener('click', () => openDetail(show[Number(card.dataset.i)]));
    });
  }

  function openDetail(r) {
    if (!r) return;
    $('detailName').textContent = r.name;
    $('detailBody').innerHTML = `
      <div class="d-row"><span>Rider ID</span><strong>${escapeHtml(r.id)}</strong></div>
      <div class="d-row"><span>الحالة</span><strong>${escapeHtml(r.status)}</strong></div>
      <div class="d-row"><span>الموبايل</span><strong>${escapeHtml(r.phone || '—')}</strong></div>
      <div class="d-row"><span>الرقم القومي</span><strong>${escapeHtml(r.nationalId || '—')}</strong></div>
      <div class="d-row"><span>المنطقة</span><strong>${escapeHtml(r.area || '—')}</strong></div>
      <div class="d-row"><span>المدينة</span><strong>${escapeHtml(r.city || '—')}</strong></div>
      <div class="d-row"><span>المشرف</span><strong>${escapeHtml(r.supervisor || '—')}</strong></div>
      <div class="d-row"><span>مدير المنطقة</span><strong>${escapeHtml(r.manager || '—')}</strong></div>
      <div class="d-row"><span>3PL</span><strong>${escapeHtml(r.pl3 || '—')}</strong></div>
      <div class="d-actions">
        ${r.phone ? `<a class="btn-call" href="tel:${escapeAttr(r.phone)}">اتصال</a>` : '<span></span>'}
        <button type="button" class="btn-copy" id="copyBtn">نسخ البيانات</button>
      </div>`;
    $('detailModal').classList.remove('hidden');
    const copyBtn = $('copyBtn');
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const text = [r.name, 'ID: ' + r.id, r.phone, r.area, r.supervisor, r.status].filter(Boolean).join('\n');
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = 'تم النسخ ✓';
          setTimeout(() => (copyBtn.textContent = 'نسخ البيانات'), 1200);
        } catch {
          copyBtn.textContent = 'فشل';
        }
      };
    }
  }

  function closeDetail() {
    $('detailModal').classList.add('hidden');
  }
  $('detailClose').addEventListener('click', closeDetail);
  $('modalBg').addEventListener('click', closeDetail);

  ['rsSearch', 'rsStatus', 'rsArea', 'rsSuper'].forEach((id) => {
    $(id).addEventListener(id === 'rsSearch' ? 'input' : 'change', applyRosterFilters);
  });
  $('rsClear').addEventListener('click', () => {
    $('rsSearch').value = '';
    $('rsStatus').value = 'all';
    $('rsArea').value = 'all';
    $('rsSuper').value = 'all';
    applyRosterFilters();
  });

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }



  /* ========== LIVE via local proxy ========== */
  const LIVE_CITIES = [
    { id: 1, label: 'القاهرة / المركز' },
    { id: 200, label: 'مدينة 200' },
    { id: 296, label: 'مدينة 296' }
  ];

  let liveRiders = [];
  let sheetLiveRiders = [];
  let liveFilter = 'all';
  let liveOnlyOurs = true;
  let liveRegion = 'all'; // مناديب EL ABTAL / الموجودين في الروستر
  let liveCityId = 'all';
  let liveTimer = null;
  let liveCountdown = 30;
  let liveCountdownTimer = null;

  function liveStatusBucket(status) {
    const s = String(status || '').trim().toLowerCase();

    if (s.includes('break') || s.includes('بريك') || s.includes('راحة')) {
      return 'break';
    }

    if (
      s === 'working' ||
      s.includes('شغال') ||
      s.includes('يعمل') ||
      s === 'عمل' ||
      s.includes('نشط') ||
      s === 'on shift' ||
      s === 'on-shift' ||
      s === 'active' ||
      s === 'online' ||
      s === 'in progress' ||
      s === 'available'
    ) {
      return 'working';
    }

    return 'other';
  }

  function formatDuration(sec) {
    sec = Number(sec) || 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h <= 0) return m + 'د';
    return h + 'س ' + m + 'د';
  }

  function buildCityTabs() {
    const wrap = $('cityTabs');
    if (!wrap) return;
    const allActive = !liveCityId || liveCityId === 'all' ? ' active' : '';
    wrap.innerHTML =
      `<button type="button" class="city-tab${allActive}" data-city="all">كل المدن</button>` +
      LIVE_CITIES.map((c) => {
        const active = String(c.id) === String(liveCityId) ? ' active' : '';
        return `<button type="button" class="city-tab${active}" data-city="${c.id}">${escapeHtml(c.label)}</button>`;
      }).join('');

    wrap.querySelectorAll('.city-tab[data-city]').forEach((btn) => {
      btn.addEventListener('click', () => {
        liveCityId = btn.dataset.city;
        wrap.querySelectorAll('.city-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderLive();
      });
    });
  }

  function stopLiveAuto() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    if (liveCountdownTimer) {
      clearInterval(liveCountdownTimer);
      liveCountdownTimer = null;
    }
  }

  function startLiveAuto() {
    stopLiveAuto();
    liveCountdown = 30;
    updateAutoBadge();
    liveTimer = setInterval(() => loadLive(false), 30000);
    liveCountdownTimer = setInterval(() => {
      liveCountdown -= 1;
      if (liveCountdown <= 0) liveCountdown = 30;
      updateAutoBadge();
    }, 1000);
  }

  function updateAutoBadge() {
    const el = $('lvAutoBadge');
    if (el) el.textContent = liveCountdown + 'ث';
  }

  async function loadLive(force) {
    const loading = $('liveLoading');
    const empty = $('liveEmpty');
    const list = $('liveList');

    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if ($('lvStatusMsg')) $('lvStatusMsg').textContent = 'جاري تحميل بيانات اللايف...';

    try {
      // Keep Google Sheets data separate for bookings and work-hours.
      try {
        const sheetRows = await fetchSheetValues(!!force, 'سحبه لايف');
        const parsed = parseCSV(rowsToCSV(sheetRows));
        sheetLiveRiders = parsed
          .filter(r => r && (r.id || r.name))
          .map(r => ({
            employee_id: String(r.id || '').trim(),
            name: r.name || '',
            phone_number: r.phone || '',
            status: r.status || '',
            shiftStart: r.shiftStart || '',
            shiftEnd: r.shiftEnd || '',
            zone: { name: r.area || '' },
            starting_point: { name: r.area || '' },
            deliveries_info: {},
            performance: {},
            _fromSheet: true
          }));
      } catch (sheetErr) {
        console.warn('[ALABTAL] Sheet data unavailable for bookings:', sheetErr);
      }

      // Desktop API is the source for the Live screen only.
      const response = await fetch('/api/live-ops?city=tanta', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const data = await response.json();

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || ('تعذر تحميل اللايف: HTTP ' + response.status));
      }

      const cards = Array.isArray(data.cards) ? data.cards
        : Array.isArray(data.riders) ? data.riders
        : Array.isArray(data.data) ? data.data : null;

      if (!cards) {
        throw new Error('رد الـ API لا يحتوي على قائمة cards أو riders أو data');
      }

      liveRiders = cards.filter(r => r && (r.empId != null || r.id != null || r.name))
        .map(r => {
          const hours = Number(r.hours);
          const workedSeconds = Number.isFinite(hours) && hours > 0 ? hours * 3600 : 0;
          const activeOrders = Array.isArray(r.activeOrders) ? r.activeOrders : [];
          const hasOrder = Boolean(r.hasOrderNow || activeOrders.length);

          return {
            employee_id: String(r.empId ?? r.id ?? '').trim(),
            name: r.name || '',
            phone_number: r.phone || r.phone_number || '',
            status: r.status || '',
            shiftStart: r.shiftStart || '',
            shiftEnd: r.shiftEnd || '',
            active_shift_started_at: r.shiftStart || '',
            active_shift_ended_at: r.shiftEnd || '',
            zone: { name: r.zone || r.area || 'طنطا' },
            starting_point: { name: r.zone || r.area || 'طنطا' },
            deliveries_info: {
              completed_deliveries_count: Number(r.orders) || 0,
              has_active_deliveries: hasOrder
            },
            performance: {
              time_spent: {
                worked_seconds: workedSeconds,
                break_seconds: Number(r.currentBreakSeconds) || 0
              },
              utilization_rate: r.utr ?? r.acceptanceRate
            },
            wallet_info: { balance: r.wallet },
            _city_id: '214',
            _fromDesktop: true
          };
        });

      liveCountdown = 30;
      updateAutoBadge();

      if ($('lvStatusMsg')) {
        const statusCounts = {};
        liveRiders.forEach(r => {
          const st = String(r.status || 'فارغ').trim() || 'فارغ';
          statusCounts[st] = (statusCounts[st] || 0) + 1;
        });
        $('lvStatusMsg').textContent =
          'Desktop Live · ' + liveRiders.length + ' مندوب · ' +
          Object.entries(statusCounts).map(([k, v]) => k + ': ' + v).join(' | ');
      }

      renderLive();
      syncBookingsFromLive();
    } catch (err) {
      console.error('[ALABTAL Desktop Live]', err);
      liveRiders = [];
      if (list) {
        list.innerHTML =
          '<div class="empty-box"><h3>تعذر تحميل بيانات اللايف</h3><p>' +
          escapeHtml(err.message || String(err)) +
          '</p><p>تأكد من تسجيل الدخول إلى Desktop Proxy ثم حدّث الصفحة.</p></div>';
      }
      if ($('lvStatusMsg')) $('lvStatusMsg').textContent = 'تعذر الاتصال بـ Desktop Live';
      updateLiveStats([]);
      syncBookingsFromLive();
    } finally {
      if (loading) loading.classList.add('hidden');
    }
  }

  const ACTUAL_HOURS_KEY = 'alabtal_actual_work_hours_v1';

  function formatActualWorkHours(rows, regionFilter) {
    let data = {};
    try {
      data = JSON.parse(localStorage.getItem(ACTUAL_HOURS_KEY) || '{}');
    } catch (_) {
      data = {};
    }

    data.riders = data.riders || {};
    const now = Date.now();

    const dayKey = (ts) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date(ts));
      const v = {};
      parts.forEach(p => v[p.type] = p.value);
      return `${v.year}-${v.month}-${v.day}`;
    };

    function addSecondsToRider(riderData, start, seconds) {
      if (seconds <= 0) return;
      riderData.days = riderData.days || {};
      let remaining = seconds;
      let cursor = start;

      while (remaining > 0) {
        const day = dayKey(cursor);
        let next = cursor + 1000;
        while (next < cursor + remaining * 1000 &&
               dayKey(next) === day) {
          next += 1000;
        }

        let chunk = Math.max(1, Math.floor((next - cursor) / 1000));
        chunk = Math.min(chunk, remaining);
        riderData.days[day] = (Number(riderData.days[day]) || 0) + chunk;
        cursor += chunk * 1000;
        remaining -= chunk;
      }
    }

    const sheetRows = (Array.isArray(rows) ? rows : [])
      .filter(r => r && r._fromSheet &&
        String(r.employee_id || '').trim());

    sheetRows.forEach(r => {
      const id = String(r.employee_id).trim();
      const status = liveStatusBucket(r.status);
      const region = riderRegionKey(r);
      const prev = data.riders[id];

      if (prev && prev.status === 'working' && prev.lastSeen) {
        const elapsed = Math.min(
          45,
          Math.max(0, Math.floor((now - prev.lastSeen) / 1000))
        );

        if (elapsed > 0) {
          addSecondsToRider(prev, prev.lastSeen, elapsed);
        }
      }

      data.riders[id] = {
        ...(prev || {}),
        status,
        region,
        lastSeen: now,
        days: (prev && prev.days) || {}
      };
    });

    try {
      localStorage.setItem(ACTUAL_HOURS_KEY, JSON.stringify(data));
    } catch (_) {}

    const today = dayKey(now);
    let seconds = 0;

    Object.values(data.riders).forEach(r => {
      if (!r) return;
      if (regionFilter && regionFilter !== 'all' &&
          r.region !== regionFilter) return;
      seconds += Number((r.days || {})[today]) || 0;
    });

    return Math.floor(seconds / 3600) + 'h';
  }

  function updateLiveStats(rows) {
    const working = rows.filter((r) => liveStatusBucket(r.status) === 'working').length;
    const br = rows.filter((r) => liveStatusBucket(r.status) === 'break').length;
    const orders = rows.filter((r) => r.deliveries_info && r.deliveries_info.has_active_deliveries).length;

    const completedOrders = rows.reduce((sum, r) => {
      const n = Number(r?.deliveries_info?.completed_deliveries_count);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);

    const workedSeconds = rows.reduce((sum, r) => {
      const n = Number(r?.performance?.time_spent?.worked_seconds);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);

    const sheetRiders = rows.filter(r => r && r._fromSheet);
    const hoursSource = sheetRiders.length ? sheetRiders : [];
    const totalShiftMinutes = hoursSource.reduce((sum, r) => {
      const duration = calcShiftDuration(r.shiftStart, r.shiftEnd);
      const m = String(duration).match(/(\d+)\s*س(?:\s*و\s*(\d+)\s*د)?/);
      if (!m) return sum;
      return sum + Number(m[1]) * 60 + Number(m[2] || 0);
    }, 0);

    const workedHours = formatActualWorkHours(sheetLiveRiders, liveRegion);

    if ($('lvWorking')) $('lvWorking').textContent = working.toLocaleString('ar-EG');
    if ($('lvBreak')) $('lvBreak').textContent = br.toLocaleString('ar-EG');
    if ($('lvOrders')) $('lvOrders').textContent = orders.toLocaleString('ar-EG');
    if ($('lvTotal')) $('lvTotal').textContent = rows.length.toLocaleString('ar-EG');
    if ($('lvHours')) $('lvHours').textContent = workedHours;
    if ($('lvCompletedOrders')) $('lvCompletedOrders').textContent = completedOrders.toLocaleString('ar-EG');
  }



  function riderRegionKey(r) {
    const blob = [
      r && r.zone && r.zone.name,
      r && r.starting_point && r.starting_point.name,
      r && r.city_name,
      r && r._city_id
    ].join(' ').toLowerCase();
    if (/tanta|طنطا|gharb|غرب/.test(blob)) return 'tanta';
    if (/zagazig|زقازيق|sharkia|شرق|zagazi/.test(blob)) return 'zagazig';
    if (/alex|إسكند|اسكند|alexandria/.test(blob)) return 'alex';
    if (/cairo|قاهر|giza|جيزة|6th|october|nasr|maadi|helwan|shubra|مدينة نصر|المعادي/.test(blob)) return 'cairo';
    if (String(r && r._city_id) === '1') return 'cairo';
    return 'other';
  }

  function isOurRider(r) {
    if (!r) return false;
    const id = String(r.employee_id || '');
    // أولاً: ID موجود في الشيت الجديد
    if (id && typeof allRiders !== 'undefined' && allRiders && allRiders.length) {
      if (allRiders.some((x) => String(x.id) === id)) return true;
    }
    const name = String(r.name || '');
    if (/el\s*abtal/i.test(name) || /_EL ABTAL/i.test(name)) return true;
    return false;
  }

  
function calcShiftDuration(start, end) {
  function toMinutes(value) {
    let s = String(value || '').trim();
    if (!s || s === '—' || s === '-') return null;

    const ampm = /\b(am|pm)\b/i.exec(s);
    const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;

    let h = Number(m[1]);
    const min = Number(m[2]);

    if (h > 23 || min > 59) return null;

    if (ampm) {
      const period = ampm[1].toLowerCase();
      if (h < 1 || h > 12) return null;
      if (period === 'pm' && h < 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
    }

    return h * 60 + min;
  }

  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === null || b === null || a === b) return a === b ? '24 س' : '—';

  let diff = b - a;
  if (diff < 0) diff += 1440;

  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return `${hours} س${minutes ? ' و ' + minutes + ' د' : ''}`;
}


function renderWorkHours() {
    const list = $('hoursList');
    const empty = $('hoursEmpty');
    const totalEl = $('hoursTotal');
    const countEl = $('hoursCount');

    if (!list || !totalEl || !countEl) return;

    const rows = (liveRiders || []).filter(r =>
      r && (r.name || r.employee_id) && r._fromSheet
    );

    let totalMinutes = 0;
    let validCount = 0;

    list.innerHTML = rows.map(r => {
      const start = r.shiftStart || '';
      const end = r.shiftEnd || '';
      const duration = calcShiftDuration(start, end);

      const match = duration.match(/(\d+)\s*س(?:\s*و\s*(\d+)\s*د)?/);
      if (match) {
        totalMinutes += Number(match[1]) * 60 + Number(match[2] || 0);
        validCount++;
      }

      return `<article class="live-card st-other">
        <div class="live-card-top">
          <h3>${escapeHtml(r.name || 'مندوب بدون اسم')}</h3>
        </div>
        <div class="live-card-body">
          <div>ID: <b>${escapeHtml(r.employee_id || '—')}</b></div>
          <div>بداية الشيفت: <b>${escapeHtml(start || '—')}</b></div>
          <div>نهاية الشيفت: <b>${escapeHtml(end || '—')}</b></div>
          <div>عدد الساعات: <b>${escapeHtml(duration)}</b></div>
        </div>
      </article>`;
    }).join('');

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    totalEl.textContent = `${hours} س${minutes ? ' و ' + minutes + ' د' : ''}`;
    countEl.textContent = rows.length;

    if (empty) empty.classList.toggle('hidden', rows.length > 0);
  }

function renderLive() {
    const q = (($('lvSearch') && $('lvSearch').value) || '').trim().toLowerCase();
    let rows = liveRiders.slice();
    // Desktop Live API يعيد المناديب المسموح بعرضهم؛ لا تستبعدهم بسبب مطابقة الشيت
    if (liveOnlyOurs) {
      rows = rows.filter((r) => r._fromDesktop || r._fromSheet || isOurRider(r));
    }
    // فلتر مدينة اختياري من التابات (لو اختار مدينة معينة)
    if (liveCityId && liveCityId !== 'all') {
      rows = rows.filter((r) => String(r._city_id || '') === String(liveCityId));
    }
    if (liveRegion && liveRegion !== 'all') {
      rows = rows.filter((r) => riderRegionKey(r) === liveRegion);
    }
    if (liveFilter !== 'all') {
      rows = rows.filter((r) => liveStatusBucket(r.status) === liveFilter);
    }
    if (q) {
      rows = rows.filter((r) => {
        const hay = [
          r.name,
          r.employee_id,
          r.phone_number,
          r.zone && r.zone.name,
          r.starting_point && r.starting_point.name,
          r.status
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    updateLiveStats(rows);

    if ($('lvCount')) $('lvCount').textContent = rows.length.toLocaleString('ar-EG') + ' مندوب';
    const list = $('liveList');
    const empty = $('liveEmpty');
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');

    list.innerHTML = rows
      .map((r) => {
        const name = String(r.name || '').replace(/\s*_EL ABTAL(_BC)?/gi, '').trim();
        const st = r.status || '—';
        const bucket = liveStatusBucket(st);
        const zone = (r.zone && r.zone.name) || '—';
        const sp = (r.starting_point && r.starting_point.name) || '—';
        const shiftStart = r.shiftStart || '—';
        const shiftEnd = r.shiftEnd || '—';
    const shiftDuration = calcShiftDuration(shiftStart, shiftEnd);
        const phone = r.phone_number || '';
        const di = r.deliveries_info || {};
        const done = di.completed_deliveries_count || 0;
        const active = !!di.has_active_deliveries;
        const perf = r.performance || {};
        const ts = (perf.time_spent) || {};
        const utr = perf.utilization_rate;
        const worked = formatDuration(ts.worked_seconds);
        const brk = formatDuration(ts.break_seconds);
        const wallet = r.wallet_info && r.wallet_info.balance != null ? Number(r.wallet_info.balance).toFixed(0) : null;
        const tel = phone ? phone.replace(/[^\d+]/g, '') : '';

        return `<article class="live-card st-${bucket}">
          <div class="live-card-top">
            <h3>${escapeHtml(name)}</h3>
            <div class="live-badges">
              <span class="live-pill ${bucket}">${escapeHtml(st)}</span>
              ${active ? '<span class="live-pill order">معاه أوردر</span>' : ''}
            </div>
          </div>
          <div class="live-grid">
            <div>ID: <b>${escapeHtml(r.employee_id)}</b></div>
            <div>تم: <b>${done}</b></div>
            <div>زون: <b>${escapeHtml(zone)}</b></div>
            <div>نقطة: <b>${escapeHtml(sp)}</b></div>
            <div>بداية الشيفت: <b>${escapeHtml(shiftStart)}</b></div>
            <div>نهاية الشيفت: <b>${escapeHtml(shiftEnd)}</b></div>
        <div>عدد الساعات: <b>${escapeHtml(shiftDuration)}</b></div>
            <div>شغل: <b>${escapeHtml(worked)}</b></div>
            <div>بريك: <b>${escapeHtml(brk)}</b></div>
            ${utr != null ? `<div>UTR: <b>${escapeHtml(utr)}</b></div>` : ''}
            ${wallet != null ? `<div>محفظة: <b>${escapeHtml(wallet)}</b></div>` : ''}
          </div>
          <div class="live-actions">
            ${tel ? `<a class="call" href="tel:${escapeAttr(tel)}">اتصال</a>` : '<span></span>'}
            <button type="button" data-copy="${escapeAttr(phone)}">نسخ</button>
          </div>
        </article>`;
      })
      .join('');

    list.querySelectorAll('button[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.getAttribute('data-copy') || '');
          btn.textContent = 'تم ✓';
          setTimeout(() => (btn.textContent = 'نسخ'), 1000);
        } catch {
          btn.textContent = 'فشل';
        }
      });
    });
  }

  if ($('lvRefreshBtn')) $('lvRefreshBtn').addEventListener('click', () => loadLive(true));
  if ($('lvSearch')) $('lvSearch').addEventListener('input', renderLive);
  document.querySelectorAll('#liveSubTabs .sub-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#liveSubTabs .sub-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      liveFilter = btn.dataset.live || 'all';
      renderLive();
    });
  });

  buildCityTabs();

  const _setMode = setMode;
  setMode = function (mode) {
    _setMode(mode);
    if (mode === 'live') {
      loadLive(false);
      startLiveAuto();
    } else {
      stopLiveAuto();
    }
  };

  // بعد الدخول: حمّل اللايف في الخلفية عشان أول ما تفتح التاب يكون جاهز
  const _showApp = showApp;
  showApp = function () {
    _showApp();
    setTimeout(() => {
      loadLive(false);
    }, 1200);
  };

  // تبديل فلتر مناديبنا
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.id === 'lvOursToggle') {
      liveOnlyOurs = !liveOnlyOurs;
      t.classList.toggle('active', liveOnlyOurs);
      t.textContent = liveOnlyOurs ? 'مناديبنا فقط' : 'كل المناديب';
      renderLive();
    }
  });


  /* ========== Bookings derived from LIVE + roster ========== */
  let bkSub = 'onshift';

  function fmtShiftTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '—';
    }
  }

  function syncBookingsFromLive() {
    const ours = (sheetLiveRiders || []).filter((r) => r && r._fromSheet);
    const working = ours.filter((r) => liveStatusBucket(r.status) === 'working');
    const onBreak = ours.filter((r) => liveStatusBucket(r.status) === 'break');
    const withOrder = ours.filter((r) => r.deliveries_info && r.deliveries_info.has_active_deliveries);

    // roster force from Google Sheet
    const rosterTotal = (typeof allRiders !== 'undefined' && allRiders) ? allRiders.length : 0;
    const liveIds = new Set(ours.map((r) => String(r.employee_id)));
    let missing = 0;
    if (rosterTotal) {
      missing = allRiders.filter((r) => r.id && !liveIds.has(String(r.id))).length;
    }

    if ($('stBooked')) $('stBooked').textContent = ours.length.toLocaleString('ar-EG');
    if ($('stWorking')) $('stWorking').textContent = working.length.toLocaleString('ar-EG');
    if ($('stBreak')) $('stBreak').textContent = onBreak.length.toLocaleString('ar-EG');
    if ($('stWithOrder')) $('stWithOrder').textContent = withOrder.length.toLocaleString('ar-EG');
    if ($('stForce')) $('stForce').textContent = rosterTotal ? rosterTotal.toLocaleString('ar-EG') : '—';
    if ($('stNot')) $('stNot').textContent = rosterTotal ? missing.toLocaleString('ar-EG') : '—';

    renderBookings();
  }

  function getBookingsRows() {
    const ours = (sheetLiveRiders || []).filter((r) => r && r._fromSheet);
    const q = (($('bkSearch') && $('bkSearch').value) || '').trim().toLowerCase();

    if (bkSub === 'roster_missing') {
      const liveIds = new Set(ours.map((r) => String(r.employee_id)));
      let rows = (typeof allRiders !== 'undefined' && allRiders) ? allRiders.slice() : [];
      rows = rows.filter((r) => r.id && !liveIds.has(String(r.id)));
      if (q) {
        rows = rows.filter((r) => [r.name, r.id, r.phone, r.area, r.supervisor].join(' ').toLowerCase().includes(q));
      }
      return rows.map((r) => ({ _type: 'roster', r: r }));
    }

    let rows = ours.slice();
    if (bkSub === 'working') rows = rows.filter((r) => liveStatusBucket(r.status) === 'working');
    if (bkSub === 'break') rows = rows.filter((r) => liveStatusBucket(r.status) === 'break');
    if (bkSub === 'order') rows = rows.filter((r) => r.deliveries_info && r.deliveries_info.has_active_deliveries);
    // onshift = all ours on live

    if (q) {
      rows = rows.filter((r) => {
        const hay = [
          r.name, r.employee_id, r.phone_number,
          r.zone && r.zone.name,
          r.starting_point && r.starting_point.name,
          r.status
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return rows.map((r) => ({ _type: 'live', r: r }));
  }

  function renderBookings() {
    const list = $('bookingsList');
    const empty = $('bookingsEmpty');
    if (!list) return;
    const rows = getBookingsRows();
    if ($('bkCount')) $('bkCount').textContent = rows.length.toLocaleString('ar-EG') + ' نتيجة';

    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');

    list.innerHTML = rows.map((item) => {
      if (item._type === 'roster') {
        const r = item.r;
        return `<article class="live-card st-other">
          <div class="live-card-top">
            <h3>${escapeHtml(r.name)}</h3>
            <span class="live-pill other">مش في اللايف</span>
          </div>
          <div class="live-grid">
            <div>ID: <b>${escapeHtml(r.id)}</b></div>
            <div>حالة الروستر: <b>${escapeHtml(r.status || '—')}</b></div>
            <div>منطقة: <b>${escapeHtml(r.area || '—')}</b></div>
            <div>مشرف: <b>${escapeHtml(r.supervisor || '—')}</b></div>
          </div>
          <div class="live-actions">
            ${r.phone ? `<a class="call" href="tel:${escapeAttr(String(r.phone).replace(/[^\\d+]/g,''))}">اتصال</a>` : '<span></span>'}
            <button type="button" data-copy="${escapeAttr([r.name,'ID: '+r.id,r.phone,r.area].filter(Boolean).join('\\n'))}">نسخ</button>
          </div>
        </article>`;
      }
      const r = item.r;
      const name = String(r.name || '').replace(/\\s*_EL ABTAL(_BC)?/gi, '').trim();
      const bucket = liveStatusBucket(r.status);
      const zone = (r.zone && r.zone.name) || '—';
      const sp = (r.starting_point && r.starting_point.name) || '—';
      const phone = r.phone_number || '';
      const di = r.deliveries_info || {};
      const active = !!di.has_active_deliveries;
      const done = di.completed_deliveries_count || 0;
      const start = fmtShiftTime(r.active_shift_started_at);
      const end = fmtShiftTime(r.active_shift_ended_at);
      const tel = phone ? phone.replace(/[^\\d+]/g, '') : '';
      return `<article class="live-card st-${bucket}">
        <div class="live-card-top">
          <h3>${escapeHtml(name)}</h3>
          <div class="live-badges">
            <span class="live-pill ${bucket}">${escapeHtml(r.status || '—')}</span>
            ${active ? '<span class="live-pill order">معاه أوردر</span>' : ''}
          </div>
        </div>
        <div class="live-grid">
          <div>ID: <b>${escapeHtml(r.employee_id)}</b></div>
          <div>تم: <b>${done}</b></div>
          <div>بداية الشفت: <b>${escapeHtml(start)}</b></div>
          <div>نهاية الشفت: <b>${escapeHtml(end)}</b></div>
          <div>زون: <b>${escapeHtml(zone)}</b></div>
          <div>نقطة: <b>${escapeHtml(sp)}</b></div>
        </div>
        <div class="live-actions">
          ${tel ? `<a class="call" href="tel:${escapeAttr(tel)}">اتصال</a>` : '<span></span>'}
          <button type="button" data-copy="${escapeAttr(phone)}">نسخ</button>
        </div>
      </article>`;
    }).join('');

    list.querySelectorAll('button[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.getAttribute('data-copy') || '');
          btn.textContent = 'تم ✓';
          setTimeout(() => (btn.textContent = 'نسخ'), 1000);
        } catch (e) {
          btn.textContent = 'فشل';
        }
      });
    });
  }

  // bookings sub tabs
  document.querySelectorAll('#bookingsSubTabs .sub-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bookingsSubTabs .sub-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      bkSub = btn.dataset.sub || 'onshift';
      renderBookings();
    });
  });
  if ($('bkSearch')) $('bkSearch').addEventListener('input', renderBookings);
  if ($('bkCopyBtn')) {
    $('bkCopyBtn').addEventListener('click', async () => {
      const rows = getBookingsRows();
      const lines = rows.map((item, i) => {
        if (item._type === 'roster') {
          const r = item.r;
          return (i + 1) + '. ' + (r.name || '') + ' (' + (r.id || '') + ')';
        }
        const r = item.r;
        const name = String(r.name || '').replace(/\\s*_EL ABTAL(_BC)?/gi, '').trim();
        return (i + 1) + '. ' + name + ' (' + r.employee_id + ') — ' + (r.status || '');
      });
      try {
        await navigator.clipboard.writeText(lines.join('\\n'));
        $('bkCopyBtn').textContent = 'تم ✓';
        setTimeout(() => ($('bkCopyBtn').textContent = '📋 نسخ'), 1200);
      } catch (e) {
        alert('فشل النسخ');
      }
    });
  }



  // Google sign-in for read-only spreadsheet access
  const googleLoginBtn = $('googleLoginBtn');

  if (googleLoginBtn) {
    googleLoginBtn.onclick = function () {
      const msg = $('googleLoginMsg');
      if (!window.google?.accounts?.oauth2) {
        if (msg) msg.textContent = 'مكتبة Google لم تحمل بعد. حدّث الصفحة وحاول مرة أخرى.';
        return;
      }

      if (msg) msg.textContent = 'جاري فتح تسجيل الدخول من Google...';

      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        callback: function (result) {
          if (result.error || !result.access_token) {
            if (msg) msg.textContent = 'فشل الدخول. راجع إعدادات OAuth وTest users.';
            console.error('Google OAuth error:', result);
            return;
          }
          googleAccessToken = result.access_token;
          sheetTabName = null;
          // Keep the ALABTAL local username.
          if (msg) msg.textContent = 'تم تسجيل الدخول، جاري تحميل البيانات...';
          showApp();
        }
      });
      tokenClient.requestAccessToken({ prompt: '' });
    };
  }

  (async function initializeLogin() {
    try {
      const response = await fetch('/api/session', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const result = await response.json();

      if (response.ok && result.ok) {
        localStorage.setItem('alabtal_user', result.username);
        showApp();
        return;
      }
    } catch (e) {}

    localStorage.removeItem('alabtal_user');
    showLogin();
  })();
})();
