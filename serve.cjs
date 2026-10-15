const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8090;
const ROOT = path.resolve(__dirname, 'frontend');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/Loa_Boss_Time.html';
  
  const cleanPath = reqPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, cleanPath);
  
  // 安全檢查防止目錄遍歷
  if (!filePath.startsWith(ROOT)) {
    console.warn(`[403 Forbidden] filePath: ${filePath}, ROOT: ${ROOT}`);
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

function startServer(port) {
  server.removeAllListeners('error');
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[LOCAL_SERVER] 連接埠 ${port} 已被佔用，自動嘗試切換至 ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[LOCAL_SERVER_ERROR]', err);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[LOCAL_SERVER] 靜態測試伺服器已在 http://localhost:${port}/ 啟動`);
  });
}

startServer(PORT);
