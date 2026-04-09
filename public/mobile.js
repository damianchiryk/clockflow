let currentEmployee = null;

function setMessage(text, ok = false) {
  const message = document.getElementById('message');
  message.style.color = ok ? '#8ff0a4' : '#ffb0a9';
  message.textContent = text;
}
function getStoredAuth() {
  try {
    return JSON.parse(localStorage.getItem('clockflowMobileAuth') || 'null');
  } catch {
    return null;
  }
}
function saveStoredAuth(login, pin, employee) {
  localStorage.setItem('clockflowMobileAuth', JSON.stringify({ login, pin, employee }));
}
function clearStoredAuth() {
  localStorage.removeItem('clockflowMobileAuth');
}
function updateUI() {
  const authBlock = document.getElementById('authBlock');
  const employeePanel = document.getElementById('employeePanel');
  const changePinPanel = document.getElementById('changePinPanel');
  const clockPanel = document.getElementById('clockPanel');
  if (!currentEmployee) {
    authBlock.style.display = 'block';
    employeePanel.style.display = 'none';
    return;
  }
  authBlock.style.display = 'none';
  employeePanel.style.display = 'block';
  document.getElementById('profileSummary').textContent = `${currentEmployee.name} • ${currentEmployee.site} • login: ${currentEmployee.login || ''}`;
  document.getElementById('siteNote').textContent = currentEmployee.mustClock === false
    ? 'This profile does not need clock in / out.'
    : currentEmployee.geoRequired
      ? `Clocking allowed only near: ${currentEmployee.site} (${currentEmployee.radiusMeters || 200}m radius)`
      : 'Geolocation bypass enabled for this profile.';
  const needsPinChange = !!currentEmployee.mustChangePin;
  changePinPanel.style.display = needsPinChange ? 'block' : 'none';
  clockPanel.style.display = !needsPinChange && currentEmployee.mustClock !== false ? 'block' : 'none';
  renderDocsList();
}
function renderDocsList() {
  const docs = currentEmployee?.documents || [];
  document.getElementById('docsList').textContent = docs.length
    ? `Uploaded: ${docs.map(d => `${d.docType} (${d.fileName})`).join(', ')}`
    : 'No uploaded documents yet.';
}
function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}
async function mobileLogin() {
  const login = document.getElementById('loginInput').value.trim();
  const pin = document.getElementById('pinInput').value.trim();
  if (!login || !pin) {
    setMessage('Enter login and PIN');
    return;
  }
  setMessage('Please wait...', true);
  try {
    const res = await fetch('/api/mobile-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, pin })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    currentEmployee = data.employee;
    saveStoredAuth(login, pin, currentEmployee);
    setMessage(`Logged in as ${currentEmployee.name}`, true);
    updateUI();
  } catch (err) {
    setMessage(err.message || 'Login failed');
  }
}
async function changePin() {
  const auth = getStoredAuth();
  if (!auth) {
    setMessage('Please login again');
    return;
  }
  const newPin = document.getElementById('newPinInput').value.trim();
  const confirmPin = document.getElementById('confirmPinInput').value.trim();
  if (!newPin || newPin.length < 4) {
    setMessage('New PIN must be at least 4 characters');
    return;
  }
  if (newPin !== confirmPin) {
    setMessage('PIN confirmation does not match');
    return;
  }
  try {
    const res = await fetch('/api/mobile/change-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: auth.login, currentPin: auth.pin, newPin })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'PIN change failed');
    currentEmployee = data.employee;
    saveStoredAuth(auth.login, newPin, currentEmployee);
    document.getElementById('pinInput').value = newPin;
    document.getElementById('newPinInput').value = '';
    document.getElementById('confirmPinInput').value = '';
    setMessage('PIN changed successfully', true);
    updateUI();
  } catch (err) {
    setMessage(err.message || 'PIN change failed');
  }
}
async function submitClock(action) {
  const auth = getStoredAuth();
  if (!auth || !currentEmployee) {
    setMessage('Please login first');
    return;
  }
  setMessage('Please wait...', true);
  const payload = { login: auth.login, pin: auth.pin, action };
  try {
    if (currentEmployee.geoRequired) {
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
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    currentEmployee = data.employee || currentEmployee;
    saveStoredAuth(auth.login, auth.pin, currentEmployee);
    setMessage(`${data.message} at ${data.entry.localTime}`, true);
  } catch (err) {
    setMessage(err.message || 'Location request failed');
  }
}
async function uploadDocument() {
  const auth = getStoredAuth();
  const fileInput = document.getElementById('docFileInput');
  const file = fileInput.files[0];
  if (!auth || !currentEmployee) {
    setMessage('Please login first');
    return;
  }
  if (!file) {
    setMessage('Choose a file first');
    return;
  }
  const docType = document.getElementById('docTypeSelect').value;
  const base64 = await file.arrayBuffer().then(buf => btoa(String.fromCharCode(...new Uint8Array(buf))));
  try {
    const res = await fetch('/api/mobile/upload-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: auth.login,
        pin: auth.pin,
        docType,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    currentEmployee.documents = data.documents || [];
    saveStoredAuth(auth.login, auth.pin, currentEmployee);
    fileInput.value = '';
    renderDocsList();
    setMessage('Document uploaded', true);
  } catch (err) {
    setMessage(err.message || 'Upload failed');
  }
}
function logoutMobile() {
  currentEmployee = null;
  clearStoredAuth();
  document.getElementById('loginInput').value = '';
  document.getElementById('pinInput').value = '';
  setMessage('Logged out', true);
  updateUI();
}

document.getElementById('loginMobileBtn').addEventListener('click', mobileLogin);
document.getElementById('changePinBtn').addEventListener('click', changePin);
document.getElementById('clockInBtn').addEventListener('click', () => submitClock('in'));
document.getElementById('clockOutBtn').addEventListener('click', () => submitClock('out'));
document.getElementById('uploadDocBtn').addEventListener('click', uploadDocument);
document.getElementById('logoutMobileBtn').addEventListener('click', logoutMobile);

window.addEventListener('DOMContentLoaded', () => {
  const auth = getStoredAuth();
  if (auth?.employee) {
    currentEmployee = auth.employee;
    document.getElementById('loginInput').value = auth.login || '';
    document.getElementById('pinInput').value = auth.pin || '';
  }
  updateUI();
});
