const http = require('http');

const PORT = Number(process.env.PORT) || 4000;
const HOST = '0.0.0.0';

function html(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; background: #111827; color: #f9fafb; }
    .card { max-width: 700px; margin: 40px auto; padding: 24px; border-radius: 16px; background: #1f2937; }
    h1 { margin-top: 0; }
    a { color: #93c5fd; }
    code { background: #374151; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="card">${body}</div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  console.log(`[${new Date().toISOString()}] ${req.method} ${url}`);

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html('ClockFlow', `
      <h1>ClockFlow online</h1>
      <p>Server działa poprawnie.</p>
      <p><a href="/health">/health</a></p>
      <p><a href="/admin">/admin</a></p>
      <p><a href="/mobile">/mobile</a></p>
    `));
  }

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('OK');
  }

  if (url === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html('ClockFlow Admin', `
      <h1>ClockFlow Admin działa</h1>
      <p>Ta strona odpowiada z Railway.</p>
    `));
  }

  if (url === '/mobile') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html('ClockFlow Mobile', `
      <h1>ClockFlow Mobile działa</h1>
      <p>Ta strona odpowiada z Railway.</p>
    `));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`ClockFlow listening on ${HOST}:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
