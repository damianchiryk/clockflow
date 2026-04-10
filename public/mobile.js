const AUTH_KEY = 'clockflowMobileAuth';
let auth = null;
let currentState = { currentlyClockedIn: false };

function qs(id) { return document.getElementById(id); }

function setNotice(text, tone = 'ok') {
  const el = qs('topNotice');
  if (!el) return;
  el.style.display = text ? 'block' : 'none';
  el.className = `top-notice ${tone}`;
  el.textContent = text || '';
}

function setMessage(text, tone = 'ok', id = 'message') {
  const el = qs(id);
  if (!el) return;
  el.textContent = text || '';
  el.style.color = tone === 'error' ? '#ffb0a9' : tone === 'info' ? '#9cc2ff' : '#8ff0a4';
}

function saveAuth() {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}

function loadAuth() {
  try {
    auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
  } catch {
    auth = null;
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.mobile-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.menu-btn').forEach(el => el.classList.remove('active'));
  const tab = qs(tabId);
  const btn = document.querySelector(`.menu-btn[data-tab="${tabId}"]`);
  if (tab) tab.classList.add('active');
  if (btn) btn.classList.add('active');
}

function renderLoggedOut() {
  qs('loginView').style.display = 'block';
  qs('appView').style.display = 'none';
}

async function login() {
  const loginValue = qs('loginInput').value.trim();
  const pin = qs('pinInput').value.trim();

  if (!loginValue || !pin) {
    setMessage('Enter login and PIN', 'error');
    return;
  }

  setMessage('Please wait...', 'info');

  try {
    const res = await fetch('/api/mobile-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginValue, pin })
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Login failed', 'error');
      setNotice(data.error || 'Login failed', 'error');
      return;
    }

    auth = {
      employeeId: data.employee.id,
      pin,
      employee: data.employee
    };

    currentState = data.state || { currentlyClockedIn: false };
    saveAuth();
    renderLoggedIn();
    setNotice(`${data.employee.name} logged in successfully.`, 'ok');
  } catch (err) {
    const msg = err.message || 'Login failed';
    setMessage(msg, 'error');
    setNotice(msg, 'error');
  }
}

function logout() {
  auth = null;
  currentState = { currentlyClockedIn: false };
  saveAuth();
  qs('pinInput').value = '';
  renderLoggedOut();
  setNotice('Logged out.', 'info');
}

function updateClockButtons() {
  if (!auth || !auth.employee) return;

  const emp = auth.employee;
  const mustClock = emp.mustClock !== false;
  const inBtn = qs('clockInBtn');
  const outBtn = qs('clockOutBtn');

  if (!inBtn || !outBtn) return;

  if (!mustClock) {
    inBtn.disabled = true;
    outBtn.disabled = true;
    qs('siteNote').textContent = 'This profile does not need clock in / out.';
    return;
  }

  // Nie blokujemy już sztywno po local state.
  // Backend ma decydować, a UI ma nie przeszkadzać użytkownikowi.
  inBtn.disabled = false;
  outBtn.disabled = false;

  if (emp.geoRequired) {
    qs('siteNote').textContent = `Clocking allowed only near: ${emp.site}`;
  } else {
    qs('siteNote').textContent = 'Geolocation bypass enabled for this profile.';
  }
}

function renderDocuments(list) {
  const wrap = qs('documentsList');
  if (!wrap) return;

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
  if (!wrap) return;

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

  try {
    const params = new URLSearchParams({
      employeeId: auth.employeeId,
      pin: auth.pin
    });

    const res = await fetch(`/api/mobile-logs?${params}`);
    const data = await res.json();

    if (res.ok) {
      renderMyLogs(data);

      // Spróbuj wyliczyć stan z ostatniego logu zamiast ufać staremu currentState.
      if (Array.isArray(data) && data.length) {
        const latest = data[0];
        currentState.currentlyClockedIn = latest.action === 'in';
        updateClockButtons();
      }
    }
  } catch (_) {}
}

async function fetchMyDocuments() {
  if (!auth) return;

  try {
    const params = new URLSearchParams({
      employeeId: auth.employeeId,
      pin: auth.pin
    });

    const res = await fetch(`/api/mobile-documents?${params}`);
    const data = await res.json();

    if (res.ok) renderDocuments(data);
  } catch (_) {}
}

async function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

async function submitClock(action) {
  if (!auth) return;

  setMessage('Please wait...', 'info');

  const payload = {
    employeeId: auth.employeeId,
    pin: auth.pin,
    action
  };

  try {
    if (auth.employee.geoRequired) {
      const pos = await getCurrentPositionAsync();
      payload.lat = pos.coords.latitude;
      payload.lng = pos.coords.longitude;
    }

    const res = await fetch('/api/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data.error || 'Something went wrong';
      setMessage(msg, 'error');
      setNotice(msg, 'error');
      return;
    }

    if (data.state) {
      currentState = data.state;
    } else {
      currentState.currentlyClockedIn = action === 'in';
    }

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
  if (!file) {
    setMessage('Choose a file first', 'error', 'uploadMessage');
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const base64 = String(reader.result).split(',')[1];
      setMessage('Uploading...', 'info', 'uploadMessage');

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      if (!res.ok) {
        setMessage(data.error || 'Upload failed', 'error', 'uploadMessage');
        return;
      }

      setMessage('Document uploaded successfully.', 'ok', 'uploadMessage');
      qs('docFile').value = '';
      await fetchMyDocuments();
    } catch (err) {
      setMessage(err.message || 'Upload failed', 'error', 'uploadMessage');
    }
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

  // Dodatkowe odświeżenie stanu chwilę po wejściu
  setTimeout(fetchMyLogs, 500);
}

document.querySelectorAll('.menu-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

qs('loginBtn').addEventListener('click', login);
qs('logoutBtn').addEventListener('click', logout);
qs('clockInBtn').addEventListener('click', () => submitClock('in'));
qs('clockOutBtn').addEventListener('click', () => submitClock('out'));
qs('uploadBtn').addEventListener('click', uploadDocument);
qs('refreshMyLogsBtn').addEventListener('click', fetchMyLogs);

loadAuth();

if (auth?.employeeId && auth?.pin && auth?.employee) {
  renderLoggedIn();
} else {
  renderLoggedOut();
}