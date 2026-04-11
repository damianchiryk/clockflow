const AUTH_KEY = 'clockflowMobileAuth';
let auth = null;
let currentState = { currentlyClockedIn: false };

function qs(id) { return document.getElementById(id); }
function setNotice(text, tone = 'ok') {
  const el = qs('topNotice');
  el.style.display = text ? 'block' : 'none';
  el.className = `top-notice ${tone}`;
  el.textContent = text || '';
}
function setMessage(text, tone = 'ok', id = 'message') {
  const el = qs(id);
  el.textContent = text || '';
  el.style.color = tone === 'error' ? '#ffb0a9' : tone === 'info' ? '#9cc2ff' : '#8ff0a4';
}
function saveAuth() {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}
function loadAuth() {
  try { auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { auth = null; }
}
function switchTab(tabId) {
  document.querySelectorAll('.mobile-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.menu-btn').forEach(el => el.classList.remove('active'));
  qs(tabId).classList.add('active');
  document.querySelector(`.menu-btn[data-tab="${tabId}"]`).classList.add('active');
}
function renderLoggedOut() {
  qs('loginView').style.display = 'block';
  qs('appView').style.display = 'none';
}
async function login() {
  const login = qs('loginInput').value.trim();
  const pin = qs('pinInput').value.trim();
  if (!login || !pin) return setMessage('Enter login and PIN', 'error');
  setMessage('Please wait...', 'info');
  const res = await fetch('/api/mobile-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, pin })
  });
  const data = await res.json();
  if (!res.ok) return setMessage(data.error || 'Login failed', 'error');
  auth = { employeeId: data.employee.id, pin, employee: data.employee };
  currentState = data.state || { currentlyClockedIn: false };
  saveAuth();
  renderLoggedIn();
  setNotice(`${data.employee.name} logged in successfully.`, 'ok');
}
function logout() {
  auth = null;
  saveAuth();
  qs('pinInput').value = '';
  renderLoggedOut();
  setNotice('Logged out.', 'info');
}
function updateClockButtons() {
  const emp = auth.employee;
  const mustClock = emp.mustClock !== false;
  const inBtn = qs('clockInBtn');
  const outBtn = qs('clockOutBtn');
  if (!mustClock) {
    inBtn.disabled = true;
    outBtn.disabled = true;
    qs('siteNote').textContent = 'This profile does not need clock in / out.';
    return;
  }
  // Do not hard-lock buttons from stale local state. Let the backend validate.
  inBtn.disabled = false;
  outBtn.disabled = false;
  qs('siteNote').textContent = emp.geoRequired
    ? `Clocking allowed only near: ${emp.site}`
    : 'Geolocation bypass enabled for this profile.';
}
function renderDocuments(list) {
  const wrap = qs('documentsList');
  if (!list.length) {
    wrap.innerHTML = '<div class="stack-empty">No uploaded documents yet.</div>';
    return;
  }
  wrap.innerHTML = list.map(doc => `
    <div class="stack-item">
      <div><strong>${doc.docType}</strong> — ${doc.fileName}</div>
      <div class="small">${doc.uploadedAtLocal || doc.uploadedAt || ''}</div>
    </div>
  `).join('');
}
function renderMyLogs(logs) {
  const wrap = qs('myLogsList');
  if (!logs.length) {
    wrap.innerHTML = '<div class="stack-empty">No logs yet.</div>';
    return;
  }
  wrap.innerHTML = logs.map(log => `
    <div class="stack-item">
      <div><strong>${String(log.action).toUpperCase()}</strong> — ${log.localTime || log.time}</div>
      <div class="small">${log.site || ''}${log.source ? ` • ${log.source}` : ''}</div>
    </div>
  `).join('');
}
async function fetchMyLogs() {
  if (!auth) return;
  const params = new URLSearchParams({ employeeId: auth.employeeId, pin: auth.pin });
  const res = await fetch(`/api/mobile-logs?${params}`);
  const data = await res.json();
  if (res.ok) {
    renderMyLogs(data);
    if (Array.isArray(data) && data.length) {
      currentState.currentlyClockedIn = data[0].action === 'in';
      updateClockButtons();
    }
  }
}
async function fetchMyDocuments() {
  if (!auth) return;
  const params = new URLSearchParams({ employeeId: auth.employeeId, pin: auth.pin });
  const res = await fetch(`/api/mobile-documents?${params}`);
  const data = await res.json();
  if (res.ok) renderDocuments(data);
}
async function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
async function submitClock(action) {
  if (!auth) return;
  setMessage('Please wait...', 'info');
  const payload = { employeeId: auth.employeeId, pin: auth.pin, action };
  try {
    if (auth.employee.geoRequired) {
      const pos = await getCurrentPositionAsync();
      payload.lat = pos.coords.latitude;
      payload.lng = pos.coords.longitude;
    }
    const res = await fetch('/api/clock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || 'Something went wrong';
      setMessage(msg, 'error');
      setNotice(msg, 'error');
      return;
    }
    currentState = data.state || currentState;
    updateClockButtons();
    setMessage(`${data.message} at ${data.entry.localTime}`, 'ok');
    setNotice(`${data.message} at ${data.entry.localTime}`, 'ok');
    await fetchMyLogs();
  } catch (err) {
    const msg = err.message || 'Location request failed';
    setMessage(msg, 'error');
    setNotice(msg, 'error');
  }
}
async function uploadDocument() {
  if (!auth) return;
  const file = qs('docFile').files[0];
  if (!file) return setMessage('Choose a file first', 'error', 'uploadMessage');
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = String(reader.result).split(',')[1];
    setMessage('Uploading...', 'info', 'uploadMessage');
    const res = await fetch('/api/documents/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: auth.employeeId,
        pin: auth.pin,
        docType: qs('docType').value,
        fileName: file.name,
        mimeType: file.type,
        dataBase64: base64
      })
    });
    const data = await res.json();
    if (!res.ok) return setMessage(data.error || 'Upload failed', 'error', 'uploadMessage');
    setMessage('Document uploaded successfully.', 'ok', 'uploadMessage');
    qs('docFile').value = '';
    await fetchMyDocuments();
  };
  reader.readAsDataURL(file);
}
function renderLoggedIn() {
  qs('loginView').style.display = 'none';
  qs('appView').style.display = 'block';
  qs('employeeSummary').textContent = `${auth.employee.name} • ${auth.employee.site} • login: ${auth.employee.login}`;
  updateClockButtons();
  switchTab('clockTab');
  fetchMyLogs();
  fetchMyDocuments();
  setTimeout(fetchMyLogs, 500);
}

document.querySelectorAll('.menu-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
qs('loginBtn').addEventListener('click', login);
qs('logoutBtn').addEventListener('click', logout);
qs('clockInBtn').addEventListener('click', () => submitClock('in'));
qs('clockOutBtn').addEventListener('click', () => submitClock('out'));
qs('uploadBtn').addEventListener('click', uploadDocument);
qs('refreshMyLogsBtn').addEventListener('click', fetchMyLogs);

loadAuth();
if (auth?.employeeId && auth?.pin && auth?.employee) renderLoggedIn();
else renderLoggedOut();
