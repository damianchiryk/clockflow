let sites = [];
let employees = [];
let logsCache = [];
let map;
let logsPage = 1;
let failedPage = 1;
let timesheetData = null;

function getAdminPassword() {
  return sessionStorage.getItem('adminPassword') || localStorage.getItem('adminPassword') || '';
}
function adminHeaders(extra = {}) {
  return { ...extra, 'x-admin-password': getAdminPassword() };
}
function londonTime(value) {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
function dateForInput(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(value));
}
function timeForInput(value) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}
function qs(id) { return document.getElementById(id); }
function qsa(sel) { return document.querySelectorAll(sel); }
function money(value) { return `£${Number(value || 0).toFixed(2)}`; }

async function apiJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: adminHeaders(options.headers || {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function safeSetHtml(id, html) {
  const el = qs(id);
  if (el) el.innerHTML = html;
}
function safeSetText(id, text) {
  const el = qs(id);
  if (el) el.textContent = text;
}
function safeSetDisabled(id, disabled) {
  const el = qs(id);
  if (el) el.disabled = disabled;
}

function renderCardList(targetId, items, emptyText, renderer) {
  const el = qs(targetId);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="stack-empty">${emptyText}</div>`;
    return;
  }
  el.innerHTML = items.map(renderer).join('');
}

function showAdminView(view) {
  localStorage.setItem('clockflowAdminView', view);
  qsa('.admin-view').forEach(el => el.classList.remove('active'));
  qsa('.admin-nav-btn').forEach(el => el.classList.remove('active'));
  const panel = qs(`view-${view}`);
  if (panel) panel.classList.add('active');
  const btn = document.querySelector(`.admin-nav-btn[data-view="${view}"]`);
  if (btn) btn.classList.add('active');
  if (view === 'map' && map) setTimeout(() => map.invalidateSize(), 120);
  if (view === 'timesheet') fetchEmployees();
}

function defaultWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: dateForInput(monday), end: dateForInput(sunday) };
}

function clearEmployeeForm() {
  qs('employeeFormTitle').textContent = 'Add / Edit Employee';
  ['empId', 'empName', 'empLogin', 'empPin', 'empRate', 'empLunch', 'empAdvance'].forEach(id => {
    if (qs(id)) qs(id).value = '';
  });
  qs('empCompType').value = 'hourly';
  qs('empGeoRequired').checked = true;
  qs('empIsAdmin').checked = false;
  qs('empMustClock').checked = true;
  qs('empMustChangePin').checked = false;
  safeSetText('adminMessage', '');
}

function clearManualForm() {
  qs('manualFormTitle').textContent = 'Manual Clock Entry';
  qs('manualLogId').value = '';
  qs('manualAction').value = 'in';
  qs('manualDate').value = dateForInput(new Date());
  qs('manualTime').value = timeForInput(new Date()).slice(0, 5);
  qs('manualNotes').value = '';
  safeSetText('manualMessage', '');
}

function setAdminMessage(text, ok = true) {
  const el = qs('adminMessage');
  if (!el) return;
  el.style.color = ok ? '#8ff0a4' : '#ffb0a9';
  el.textContent = text;
}

async function login() {
  const password = qs('adminPassword').value.trim();
  const msg = qs('loginMessage');
  const res = await fetch('/api/admin-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await res.json();
  if (!res.ok) {
    msg.style.color = '#ffb0a9';
    msg.textContent = data.error || 'Login failed';
    return;
  }
  sessionStorage.setItem('adminPassword', password);
  localStorage.setItem('adminPassword', password);
  qs('loginCard').style.display = 'none';
  qs('adminContent').style.display = 'block';
  await initAdmin();
  showAdminView(localStorage.getItem('clockflowAdminView') || 'today');
}

async function fetchSites() {
  const data = await apiJson('/api/sites');
  sites = data;
  qs('empSite').innerHTML = sites.map(s => `<option value="${s.id}::${s.name}">${s.name}</option>`).join('');
  qs('reportSiteFilter').innerHTML =
    '<option value="">All sites</option>' +
    sites.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
}

async function fetchEmployees() {
  const res = await fetch('/api/employees');
  employees = await res.json();

  const body = qs('employeesBody');
  const manualCurrent = qs('manualEmployee')?.value || '';
  qs('manualEmployee').innerHTML = employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  if (manualCurrent && employees.some(e => e.id === manualCurrent)) qs('manualEmployee').value = manualCurrent;

  const timesheetSelect = qs('timesheetEmployee');
  if (timesheetSelect) {
    const current = timesheetSelect.value;
    timesheetSelect.innerHTML =
      '<option value="">Select employee</option>' +
      employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
    if (current && employees.some(e => e.id === current)) timesheetSelect.value = current;
  }

  if (!employees.length) {
    body.innerHTML = '<tr><td colspan="6">No employees</td></tr>';
    return;
  }

  body.innerHTML = employees.map(e => `
    <tr>
      <td>${e.name}${e.isAdmin ? ' <span class="small">(admin)</span>' : ''}</td>
      <td>${e.login || ''}</td>
      <td>${e.site}</td>
      <td>${e.compensationType || e.payType || 'hourly'} ${money(e.compensationRate ?? e.hourlyRate ?? 0)}</td>
      <td>${e.mustClock === false ? 'No' : 'Yes'}</td>
      <td class="action-links">
        <button onclick="editEmployee('${e.id}')">Edit</button>
        <button class="delete-btn" onclick="deleteEmployee('${e.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function editEmployee(id) {
  const e = employees.find(x => x.id === id);
  if (!e) return;
  qs('employeeFormTitle').textContent = 'Edit Employee';
  qs('empId').value = e.id;
  qs('empName').value = e.name || '';
  qs('empLogin').value = e.login || '';
  qs('empPin').value = '';
  qs('empRate').value = Number(e.compensationRate ?? e.hourlyRate ?? 0);
  qs('empLunch').value = Number(e.lunchMinutes || 0);
  qs('empAdvance').value = Number(e.advanceBalance || 0);
  qs('empCompType').value = e.compensationType || e.payType || 'hourly';
  qs('empGeoRequired').checked = !!e.geoRequired;
  qs('empIsAdmin').checked = !!e.isAdmin;
  qs('empMustClock').checked = e.mustClock !== false;
  qs('empMustChangePin').checked = !!e.mustChangePin;
  qs('empSite').value = `${e.siteId}::${e.site}`;
  showAdminView('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveEmployee() {
  const id = qs('empId').value;
  const siteValue = qs('empSite').value;
  if (!qs('empName').value.trim() || !siteValue || (!id && !qs('empPin').value.trim())) {
    return setAdminMessage('Please fill required fields', false);
  }
  const [siteId, site] = siteValue.split('::');
  const payload = {
    name: qs('empName').value.trim(),
    login: qs('empLogin').value.trim(),
    pin: qs('empPin').value.trim(),
    site, siteId,
    compensationType: qs('empCompType').value,
    compensationRate: Number(qs('empRate').value || 0),
    hourlyRate: Number(qs('empRate').value || 0),
    lunchMinutes: Number(qs('empLunch').value || 0),
    geoRequired: qs('empGeoRequired').checked,
    isAdmin: qs('empIsAdmin').checked,
    mustClock: qs('empMustClock').checked,
    mustChangePin: qs('empMustChangePin').checked,
    advanceBalance: Number(qs('empAdvance').value || 0)
  };
  const url = id ? `/api/employees/${id}` : '/api/employees';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) return setAdminMessage(data.error || 'Save failed', false);
  setAdminMessage(id ? 'Employee updated' : 'Employee created', true);
  clearEmployeeForm();
  await fetchEmployees();
  await fetchReport();
}

async function deleteEmployee(id) {
  if (!confirm('Delete this employee?')) return;
  const res = await fetch(`/api/employees/${id}`, { method: 'DELETE', headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Delete failed');
  await fetchEmployees();
  await fetchReport();
}

async function fetchTimesheet() {
  const employeeId = qs('timesheetEmployee')?.value;
  const start = qs('timesheetStart')?.value;
  const end = qs('timesheetEnd')?.value;

  if (!employeeId) {
    safeSetText('timesheetSummary', 'Select employee first.');
    safeSetHtml('timesheetDays', '<div class="stack-empty">No timesheet loaded.</div>');
    return;
  }

  try {
    const params = new URLSearchParams({ employeeId, start, end });
    const data = await apiJson(`/api/employee-timesheet?${params}`);
    timesheetData = data;
    renderTimesheet();
  } catch (err) {
    safeSetText('timesheetSummary', err.message || 'Failed to load timesheet.');
    safeSetHtml('timesheetDays', '<div class="stack-empty">Failed to load timesheet.</div>');
  }
}

function renderTimesheet() {
  const wrap = qs('timesheetDays');
  const summary = qs('timesheetSummary');
  if (!wrap) return;

  if (!timesheetData || !timesheetData.days) {
    wrap.innerHTML = '<div class="stack-empty">No timesheet loaded.</div>';
    if (summary) summary.textContent = '';
    return;
  }

  const total = timesheetData.days.reduce((sum, d) => sum + Number(d.totalHours || 0), 0);
  summary.textContent =
    `${timesheetData.employee.name} • ${timesheetData.start} → ${timesheetData.end} • Total hours: ${total.toFixed(2)}`;

  renderCardList('timesheetDays', timesheetData.days, 'No days in range.', day => `
    <div class="day-card">
      <div class="day-card-head">
        <div class="day-card-title">${day.date}</div>
        <div class="small">Hours: ${Number(day.totalHours || 0).toFixed(2)}${day.openSession ? ' • Open session' : ''}</div>
      </div>
      <div>
        ${(day.logs || []).length ? day.logs.map(log => `
          <div class="log-pill">
            <span><strong>${String(log.action).toUpperCase()}</strong> ${londonTime(log.time)}</span>
            <small>${log.source || 'mobile'}${log.notes ? ` • ${log.notes}` : ''}</small>
            <span class="log-actions">
              <button class="mini-btn" onclick="editLog('${log.id}')">Edit</button>
              <button class="mini-btn delete" onclick="deleteLog('${log.id}')">Delete</button>
            </span>
          </div>
        `).join('') : '<div class="stack-empty">No logs for this day.</div>'}
      </div>
      <div class="button-inline" style="margin-top:12px;">
        <button class="btn btn-refresh slim-btn" onclick="prefillManualForDay('${timesheetData.employee.id}','${day.date}','in')">Add Clock In</button>
        <button class="btn btn-refresh slim-btn" onclick="prefillManualForDay('${timesheetData.employee.id}','${day.date}','out')">Add Clock Out</button>
      </div>
    </div>
  `);
}

function prefillManualForDay(employeeId, date, action) {
  qs('manualLogId').value = '';
  qs('manualFormTitle').textContent = 'Manual Clock Entry';
  qs('manualEmployee').value = employeeId;
  qs('manualAction').value = action || 'in';
  qs('manualDate').value = date;
  qs('manualTime').value = action === 'out' ? '17:00' : '08:00';
  qs('manualNotes').value = '';
  showAdminView('timesheet');
  document.getElementById('manualFormTitle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function fetchLogs(page = logsPage) {
  logsPage = page;
  const data = await apiJson(`/api/logs?page=${page}`);
  logsCache = data.items || [];
  safeSetText('logsPageInfo', `Page ${data.pagination.page} of ${data.pagination.totalPages} • ${data.pagination.total} rows`);
  safeSetDisabled('prevLogsBtn', !data.pagination.hasPrev);
  safeSetDisabled('nextLogsBtn', !data.pagination.hasNext);

  const body = qs('logsBody');
  if (!logsCache.length) {
    body.innerHTML = '<tr><td colspan="7">No logs yet</td></tr>';
    return;
  }
  body.innerHTML = logsCache.map(log => `
    <tr>
      <td>${log.name}</td>
      <td>${log.site || ''}</td>
      <td><span class="badge ${log.action}">${String(log.action).toUpperCase()}</span></td>
      <td>${londonTime(log.time)}</td>
      <td>${log.geo?.required ? (log.geo.allowed ? `OK (${log.geo.distanceMeters ?? '-'}m)` : 'Blocked') : 'Bypass'}</td>
      <td>${log.source || 'mobile'}</td>
      <td class="action-links">
        <button onclick="editLog('${log.id}')">Edit</button>
        <button class="delete-btn" onclick="deleteLog('${log.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

function editLog(id) {
  const log = logsCache.find(x => x.id === id) || findLogInTimesheet(id);
  if (!log) return;
  qs('manualFormTitle').textContent = 'Edit Clock Entry';
  qs('manualLogId').value = log.id;
  qs('manualEmployee').value = log.employeeId;
  qs('manualAction').value = log.action;
  qs('manualDate').value = dateForInput(log.time);
  qs('manualTime').value = timeForInput(log.time).slice(0, 5);
  qs('manualNotes').value = log.notes || '';
  showAdminView('timesheet');
  document.getElementById('manualFormTitle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function findLogInTimesheet(id) {
  if (!timesheetData?.days) return null;
  for (const day of timesheetData.days) {
    const found = (day.logs || []).find(l => l.id === id);
    if (found) return found;
  }
  return null;
}

async function saveManualLog() {
  const payload = {
    employeeId: qs('manualEmployee').value,
    action: qs('manualAction').value,
    date: qs('manualDate').value,
    time: qs('manualTime').value,
    notes: qs('manualNotes').value.trim()
  };
  if (!payload.employeeId || !payload.action || !payload.date || !payload.time) {
    qs('manualMessage').style.color = '#ffb0a9';
    qs('manualMessage').textContent = 'Please fill all required fields';
    return;
  }
  const id = qs('manualLogId').value;
  const url = id ? `/api/logs/${id}` : '/api/manual-log';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  qs('manualMessage').style.color = res.ok ? '#8ff0a4' : '#ffb0a9';
  qs('manualMessage').textContent = res.ok ? (id ? 'Entry updated' : 'Manual entry added') : (data.error || 'Save failed');

  if (res.ok) {
    clearManualForm();
    await fetchLogs();
    await fetchDashboard();
    await fetchReport();
    if (timesheetData) await fetchTimesheet();
  }
}

async function deleteLog(id) {
  if (!confirm('Delete this log?')) return;
  const res = await fetch(`/api/logs/${id}`, { method: 'DELETE', headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Delete failed');
  await fetchLogs();
  await fetchDashboard();
  await fetchReport();
  if (timesheetData) await fetchTimesheet();
}

async function fetchFailedAttempts(page = failedPage) {
  failedPage = page;
  const data = await apiJson(`/api/failed-attempts?page=${page}`);
  safeSetText('failedPageInfo', `Page ${data.pagination.page} of ${data.pagination.totalPages} • ${data.pagination.total} rows`);
  safeSetDisabled('prevFailedBtn', !data.pagination.hasPrev);
  safeSetDisabled('nextFailedBtn', !data.pagination.hasNext);

  const body = qs('failedBody');
  if (!data.items.length) {
    body.innerHTML = '<tr><td colspan="5">No failed attempts</td></tr>';
    return;
  }
  body.innerHTML = data.items.map(row => `
    <tr>
      <td>${row.name || ''}</td>
      <td>${row.reason || ''}</td>
      <td>${row.action || ''}</td>
      <td>${londonTime(row.time)}</td>
      <td>${row.lat != null ? `${row.lat}, ${row.lng}` : ''}</td>
    </tr>
  `).join('');
}

async function fetchDashboard() {
  const data = await apiJson('/api/dashboard/today');
  const rows = data.employees || [];
  safeSetText('todayClockedIn', rows.filter(r => r.currentlyClockedIn).length);
  safeSetText('todayClockedOut', rows.filter(r => !r.currentlyClockedIn).length);
  safeSetText('todayPeople', rows.length);
  safeSetText('todayHours', rows.reduce((sum, r) => sum + Number(r.todayHours || 0), 0).toFixed(2));

  const body = qs('dashboardBody');
  body.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>${Number(row.todayHours || 0).toFixed(2)}</td>
      <td class="${row.currentlyClockedIn ? 'status-open' : 'status-closed'}">${row.currentlyClockedIn ? 'Clocked in' : 'Clocked out'}</td>
      <td>${row.firstIn || ''}</td>
      <td>${row.lastOut || ''}</td>
    </tr>
  `).join('') : '<tr><td colspan="6">No data</td></tr>';
}

async function fetchReport() {
  const site = qs('reportSiteFilter').value;
  const url = site ? `/api/reports/weekly?site=${encodeURIComponent(site)}` : '/api/reports/weekly';
  const data = await apiJson(url);
  const report = data.report || [];
  const body = qs('reportBody');
  body.innerHTML = report.length ? report.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>${row.compensationType}</td>
      <td>${money(row.compensationRate)}</td>
      <td>${Number(row.lunchMinutes || 0)} min</td>
      <td>${Number(row.totalHoursRaw || 0).toFixed(2)}</td>
      <td>${money(row.advanceBalance)}</td>
      <td>${money(row.totalPay)}</td>
    </tr>
  `).join('') : '<tr><td colspan="8">No report yet</td></tr>';
}

function downloadExcel() {
  const site = qs('reportSiteFilter').value;
  const qs1 = site ? `?site=${encodeURIComponent(site)}` : '';
  const password = encodeURIComponent(getAdminPassword());
  window.open(`/api/reports/weekly/excel${qs1}${qs1 ? '&' : '?'}adminPassword=${password}`, '_blank');
}

function downloadPdf() {
  const site = qs('reportSiteFilter').value;
  const qs1 = site ? `?site=${encodeURIComponent(site)}` : '';
  const password = encodeURIComponent(getAdminPassword());
  window.open(`/api/reports/weekly/pdf${qs1}${qs1 ? '&' : '?'}adminPassword=${password}`, '_blank');
}

function downloadBackup() {
  const password = encodeURIComponent(getAdminPassword());
  window.open(`/api/admin/backup/download?adminPassword=${password}`, '_blank');
}

async function initMap() {
  if (!map) {
    map = L.map('map').setView([51.48, 0.39], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }
  map.eachLayer(layer => {
    if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
  });

  sites.forEach(site => {
    if (site.lat == null || site.lng == null) return;
    L.marker([site.lat, site.lng]).addTo(map).bindPopup(`<b>${site.name}</b><br>${site.address || ''}`);
    L.circle([site.lat, site.lng], {
      radius: site.radiusMeters || 50,
      color: '#3d72f4',
      fillOpacity: 0.08
    }).addTo(map);
  });

  const points = await apiJson('/api/map/logs');
  points.forEach(p => {
    const m = L.circleMarker([p.lat, p.lng], {
      radius: 8,
      color: p.type === 'failed' ? 'red' : 'green'
    }).addTo(map);
    m.bindPopup(`<b>${p.name}</b><br>${p.type === 'failed' ? (p.reason || '') : `${p.action}`}<br>${londonTime(p.time)}`);
  });

  setTimeout(() => map.invalidateSize(), 100);
}

async function initAdmin() {
  await fetchSites();
  await fetchEmployees();
  clearEmployeeForm();
  clearManualForm();

  const range = defaultWeekRange();
  if (qs('timesheetStart')) qs('timesheetStart').value = range.start;
  if (qs('timesheetEnd')) qs('timesheetEnd').value = range.end;

  await fetchLogs(1);
  await fetchFailedAttempts(1);
  await fetchDashboard();
  await fetchReport();
  await initMap();
}

qs('loginBtn').addEventListener('click', login);
qs('saveEmployeeBtn').addEventListener('click', saveEmployee);
qs('cancelEmployeeBtn').addEventListener('click', clearEmployeeForm);
qs('refreshEmployeesBtn').addEventListener('click', fetchEmployees);
qs('saveManualBtn').addEventListener('click', saveManualLog);
qs('cancelManualBtn').addEventListener('click', clearManualForm);
qs('refreshLogsBtn').addEventListener('click', () => fetchLogs(logsPage));
qs('prevLogsBtn').addEventListener('click', () => fetchLogs(logsPage - 1));
qs('nextLogsBtn').addEventListener('click', () => fetchLogs(logsPage + 1));
qs('refreshFailedBtn').addEventListener('click', () => fetchFailedAttempts(failedPage));
qs('prevFailedBtn').addEventListener('click', () => fetchFailedAttempts(failedPage - 1));
qs('nextFailedBtn').addEventListener('click', () => fetchFailedAttempts(failedPage + 1));
qs('refreshDashboardBtn').addEventListener('click', fetchDashboard);
qs('refreshReportBtn').addEventListener('click', fetchReport);
qs('excelBtn').addEventListener('click', downloadExcel);
qs('pdfBtn').addEventListener('click', downloadPdf);
qs('backupBtn').addEventListener('click', downloadBackup);
qs('refreshMapBtn').addEventListener('click', initMap);
qs('refreshTimesheetBtn').addEventListener('click', fetchTimesheet);
qs('logoutBtn').addEventListener('click', logoutAdmin);

function logoutAdmin() {
  sessionStorage.removeItem('adminPassword');
  localStorage.removeItem('adminPassword');
  location.reload();
}

qsa('.admin-nav-btn').forEach(btn => btn.addEventListener('click', () => showAdminView(btn.dataset.view)));

window.addEventListener('DOMContentLoaded', async () => {
  const saved = getAdminPassword();
  if (saved) {
    qs('loginCard').style.display = 'none';
    qs('adminContent').style.display = 'block';
    try {
      await initAdmin();
      showAdminView(localStorage.getItem('clockflowAdminView') || 'today');
    } catch {
      sessionStorage.removeItem('adminPassword');
      localStorage.removeItem('adminPassword');
      qs('loginCard').style.display = 'block';
      qs('adminContent').style.display = 'none';
    }
  } else {
    clearManualForm();
    showAdminView('today');
  }
});

window.editEmployee = editEmployee;
window.deleteEmployee = deleteEmployee;
window.editLog = editLog;
window.deleteLog = deleteLog;
window.prefillManualForDay = prefillManualForDay;
