async function loadLogs() {
  const res = await fetch('/api/logs');
  const logs = await res.json();
  const body = document.getElementById('logsBody');

  if (!logs.length) {
    body.innerHTML = '<tr><td colspan="3">No logs yet</td></tr>';
    return;
  }

  body.innerHTML = logs.map(log => `
    <tr>
      <td>${log.name}</td>
      <td><span class="badge ${log.action}">${log.action.toUpperCase()}</span></td>
      <td>${log.localTime || new Date(log.time).toLocaleString()}</td>
    </tr>
  `).join('');
}

document.getElementById('refreshBtn').addEventListener('click', loadLogs);
loadLogs();
