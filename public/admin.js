
let sites = [];
let employees = [];
let logsCache = [];
let map;

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
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/London', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
  return parts;
}
function timeForInput(value) {
  return new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/London', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value));
}
function clearEmployeeForm() {
  document.getElementById('employeeFormTitle').textContent = 'Add / Edit Employee';
  document.getElementById('empId').value = '';
  document.getElementById('empName').value = '';
  document.getElementById('empPin').value = '';
  document.getElementById('empRate').value = '';
  document.getElementById('empLunch').value = '';
  document.getElementById('empCompType').value = 'hourly';
  document.getElementById('empGeoRequired').checked = true;
  document.getElementById('empIsAdmin').checked = false;
}
function clearManualForm() {
  document.getElementById('manualFormTitle').textContent = 'Manual Clock Entry';
  document.getElementById('manualLogId').value = '';
  document.getElementById('manualAction').value = 'in';
  document.getElementById('manualDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('manualTime').value = new Date().toTimeString().slice(0,5);
  document.getElementById('manualNotes').value = '';
}
async function login() {
  const password = document.getElementById('adminPassword').value.trim();
  const msg = document.getElementById('loginMessage');
  const res = await fetch('/api/admin-login', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ password })
  });
  const data = await res.json();
  if (!res.ok) {
    msg.style.color = '#ffb0a9';
    msg.textContent = data.error || 'Login failed';
    return;
  }
  sessionStorage.setItem('adminPassword', password);
  localStorage.setItem('adminPassword', password);
  document.getElementById('loginCard').style.display = 'none';
  document.getElementById('adminContent').style.display = 'block';
  await initAdmin();
}
async function fetchSites() {
  const res = await fetch('/api/sites', { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load sites');
  sites = data;
  const select = document.getElementById('empSite');
  select.innerHTML = `
    <option value="vrs-east-tilbury::VRS Mechanical">VRS Mechanical</option>
    <option value="vrs-east-tilbury::VRS Bodyshop">VRS Bodyshop</option>
    <option value="alk-grays::ALK Bodyshop">ALK Bodyshop</option>
  `;
}
async function fetchEmployees() {
  const res = await fetch('/api/employees');
  employees = await res.json();
  const body = document.getElementById('employeesBody');
  const manual = document.getElementById('manualEmployee');
  manual.innerHTML = employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  if (!employees.length) {
    body.innerHTML = '<tr><td colspan="6">No employees</td></tr>';
    return;
  }
  body.innerHTML = employees.map(e => `
    <tr>
      <td>${e.name}${e.isAdmin ? ' <span class="small">(admin)</span>' : ''}</td>
      <td>${e.site}</td>
      <td>${(e.compensationType || 'hourly')} £${Number(e.compensationRate ?? e.hourlyRate ?? 0).toFixed(2)}</td>
      <td>${Number(e.lunchMinutes || 0)} min</td>
      <td>${e.geoRequired ? 'Required' : 'Bypass'}</td>
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
  document.getElementById('employeeFormTitle').textContent = 'Edit Employee';
  document.getElementById('empId').value = e.id;
  document.getElementById('empName').value = e.name || '';
  document.getElementById('empPin').value = '';
  document.getElementById('empRate').value = Number(e.compensationRate ?? e.hourlyRate ?? 0);
  document.getElementById('empLunch').value = Number(e.lunchMinutes || 0);
  document.getElementById('empCompType').value = e.compensationType || 'hourly';
  document.getElementById('empGeoRequired').checked = !!e.geoRequired;
  document.getElementById('empIsAdmin').checked = !!e.isAdmin;
  const value = `${e.siteId}::${e.site}`;
  document.getElementById('empSite').value = value;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function saveEmployee() {
  const id = document.getElementById('empId').value;
  const name = document.getElementById('empName').value.trim();
  const pin = document.getElementById('empPin').value.trim();
  const siteValue = document.getElementById('empSite').value;
  const rate = document.getElementById('empRate').value;
  const lunch = document.getElementById('empLunch').value;
  const compType = document.getElementById('empCompType').value;
  const geoRequired = document.getElementById('empGeoRequired').checked;
  const isAdmin = document.getElementById('empIsAdmin').checked;
  const msg = document.getElementById('adminMessage');
  if (!name || !siteValue || (!id && !pin)) {
    msg.style.color = '#ffb0a9';
    msg.textContent = 'Please fill required fields';
    return;
  }
  const [siteId, site] = siteValue.split('::');
  const payload = {
    name, site, siteId,
    hourlyRate: Number(rate || 0),
    compensationType: compType,
    compensationRate: Number(rate || 0),
    lunchMinutes: Number(lunch || 0),
    geoRequired, isAdmin
  };
  if (pin) payload.pin = pin;
  const url = id ? `/api/employees/${id}` : '/api/employees';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: adminHeaders({ 'Content-Type':'application/json' }),
    body: JSON.stringify(id ? payload : { ...payload, pin })
  });
  const data = await res.json();
  if (!res.ok) {
    msg.style.color = '#ffb0a9';
    msg.textContent = data.error || 'Save failed';
    return;
  }
  msg.style.color = '#8ff0a4';
  msg.textContent = id ? 'Employee updated' : 'Employee created';
  clearEmployeeForm();
  await fetchEmployees();
  await fetchReport();
}
async function deleteEmployee(id) {
  if (!confirm('Delete this employee?')) return;
  const res = await fetch(`/api/employees/${id}`, { method:'DELETE', headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Delete failed'); return; }
  await fetchEmployees();
  await fetchReport();
}

async function fetchLogs() {
  const res = await fetch('/api/logs', { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load logs');
  logsCache = data;
  const body = document.getElementById('logsBody');
  if (!data.length) {
    body.innerHTML = '<tr><td colspan="7">No logs yet</td></tr>';
    return;
  }
  body.innerHTML = data.map(log => `
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
  const log = logsCache.find(x => x.id === id);
  if (!log) return;
  document.getElementById('manualFormTitle').textContent = 'Edit Clock Entry';
  document.getElementById('manualLogId').value = log.id;
  document.getElementById('manualEmployee').value = log.employeeId;
  document.getElementById('manualAction').value = log.action;
  document.getElementById('manualDate').value = dateForInput(log.time);
  document.getElementById('manualTime').value = timeForInput(log.time).slice(0,5);
  document.getElementById('manualNotes').value = log.notes || '';
  window.scrollTo({ top: 300, behavior: 'smooth' });
}
async function saveManualLog() {
  const id = document.getElementById('manualLogId').value;
  const employeeId = document.getElementById('manualEmployee').value;
  const action = document.getElementById('manualAction').value;
  const date = document.getElementById('manualDate').value;
  const time = document.getElementById('manualTime').value;
  const notes = document.getElementById('manualNotes').value.trim();
  const msg = document.getElementById('manualMessage');
  if (!employeeId || !action || !date || !time) {
    msg.style.color = '#ffb0a9';
    msg.textContent = 'Please fill all required fields';
    return;
  }
  const payload = { employeeId, action, date, time, notes };
  const url = id ? `/api/logs/${id}` : '/api/manual-log';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: adminHeaders({ 'Content-Type':'application/json' }),
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    msg.style.color = '#ffb0a9';
    msg.textContent = data.error || 'Save failed';
    return;
  }
  msg.style.color = '#8ff0a4';
  msg.textContent = id ? 'Entry updated' : 'Manual entry added';
  clearManualForm();
  await fetchLogs();
  await fetchDashboard();
  await fetchReport();
}
async function deleteLog(id) {
  if (!confirm('Delete this log?')) return;
  const res = await fetch(`/api/logs/${id}`, { method:'DELETE', headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Delete failed'); return; }
  await fetchLogs();
  await fetchDashboard();
  await fetchReport();
}
async function fetchFailedAttempts() {
  const res = await fetch('/api/failed-attempts', { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load failed attempts');
  const body = document.getElementById('failedBody');
  if (!data.length) {
    body.innerHTML = '<tr><td colspan="5">No failed attempts</td></tr>';
    return;
  }
  body.innerHTML = data.map(row => `
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
  const res = await fetch('/api/dashboard/today', { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load dashboard');
  const body = document.getElementById('dashboardBody');
  const rows = data.employees || [];
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6">No data</td></tr>';
    return;
  }
  body.innerHTML = rows.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>${Number(row.todayHours || 0).toFixed(2)}</td>
      <td class="${row.currentlyClockedIn ? 'status-open' : 'status-closed'}">${row.currentlyClockedIn ? 'Clocked in' : 'Clocked out'}</td>
      <td>${row.firstIn || ''}</td>
      <td>${row.lastOut || ''}</td>
    </tr>
  `).join('');
}
async function fetchReport() {
  const site = document.getElementById('reportSiteFilter').value;
  const url = site ? `/api/reports/weekly?site=${encodeURIComponent(site)}` : '/api/reports/weekly';
  const res = await fetch(url, { headers: adminHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load report');
  const report = data.report || [];
  const body = document.getElementById('reportBody');
  if (!report.length) {
    body.innerHTML = '<tr><td colspan="8">No report yet</td></tr>';
    return;
  }
  body.innerHTML = report.map(row => `
    <tr>
      <td>${row.name}</td>
      <td>${row.site}</td>
      <td>${row.compensationType}</td>
      <td>£${Number(row.compensationRate || 0).toFixed(2)}</td>
      <td>${Number(row.lunchMinutes || 0)} min</td>
      <td>${Number(row.totalHoursRaw || 0).toFixed(2)}</td>
      <td>${Number(row.paidHours || 0).toFixed(2)}</td>
      <td>£${Number(row.totalPay || 0).toFixed(2)}</td>
    </tr>
  `).join('');
}
function downloadExcel() {
  const site = document.getElementById('reportSiteFilter').value;
  const qs = site ? `?site=${encodeURIComponent(site)}` : '';
  const password = encodeURIComponent(getAdminPassword());
  window.open(`/api/reports/weekly/excel${qs}${qs ? '&' : '?'}adminPassword=${password}`, '_blank');
}
function downloadPdf() {
  const site = document.getElementById('reportSiteFilter').value;
  const qs = site ? `?site=${encodeURIComponent(site)}` : '';
  const password = encodeURIComponent(getAdminPassword());
  window.open(`/api/reports/weekly/pdf${qs}${qs ? '&' : '?'}adminPassword=${password}`, '_blank');
}
async function initMap() {
  if (!map) {
    map = L.map('map').setView([51.48, 0.39], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }
  // clear non-tile layers
  map.eachLayer(layer => {
    if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
  });

  sites.forEach(site => {
    const marker = L.marker([site.lat, site.lng]).addTo(map);
    marker.bindPopup(`<b>${site.name}</b><br>${site.address}`);
    L.circle([site.lat, site.lng], { radius: site.radiusMeters, color:'#3d72f4', fillOpacity:0.08 }).addTo(map);
  });

  const res = await fetch('/api/map/logs', { headers: adminHeaders() });
  const points = await res.json();
  points.forEach(p => {
    const color = p.type === 'failed' ? 'red' : 'green';
    const m = L.circleMarker([p.lat, p.lng], { radius: 8, color }).addTo(map);
    const detail = p.type === 'failed' ? (p.reason || '') : `${p.name} ${String(p.action).toUpperCase()}`;
    m.bindPopup(`<b>${p.name}</b><br>${detail}<br>${londonTime(p.time)}`);
  });
}
async function initAdmin() {
  await fetchSites();
  await fetchEmployees();
  clearEmployeeForm();
  clearManualForm();
  await fetchLogs();
  await fetchFailedAttempts();
  await fetchDashboard();
  await fetchReport();
  await initMap();
}

document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('saveEmployeeBtn').addEventListener('click', saveEmployee);
document.getElementById('cancelEmployeeBtn').addEventListener('click', clearEmployeeForm);
document.getElementById('refreshEmployeesBtn').addEventListener('click', fetchEmployees);
document.getElementById('saveManualBtn').addEventListener('click', saveManualLog);
document.getElementById('cancelManualBtn').addEventListener('click', clearManualForm);
document.getElementById('refreshLogsBtn').addEventListener('click', fetchLogs);
document.getElementById('refreshFailedBtn').addEventListener('click', fetchFailedAttempts);
document.getElementById('refreshDashboardBtn').addEventListener('click', fetchDashboard);
document.getElementById('refreshReportBtn').addEventListener('click', fetchReport);
document.getElementById('excelBtn').addEventListener('click', downloadExcel);
document.getElementById('pdfBtn').addEventListener('click', downloadPdf);
document.getElementById('refreshMapBtn').addEventListener('click', initMap);

window.addEventListener('DOMContentLoaded', async () => {
  const saved = getAdminPassword();
  if (saved) {
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
    try {
      await initAdmin();
    } catch (e) {
      sessionStorage.removeItem('adminPassword');
      localStorage.removeItem('adminPassword');
      document.getElementById('loginCard').style.display = 'block';
      document.getElementById('adminContent').style.display = 'none';
    }
  } else {
    clearManualForm();
  }
});
