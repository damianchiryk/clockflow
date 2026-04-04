const http = require('http');

const PORT = Number(process.env.PORT) || 4000;
const HOST = '0.0.0.0';

const server = http.createServer((req, res) => {
  const url = req.url;

  if (url === '/') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    return res.end('ClockFlow ONLINE');
  }

  if (url === '/health') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    return res.end('OK');
  }

  if (url === '/admin') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    return res.end('ADMIN WORKING');
  }

  if (url === '/mobile') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    return res.end('MOBILE WORKING');
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log("ClockFlow listening on " + HOST + ":" + PORT);
});