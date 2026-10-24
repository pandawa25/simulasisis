#!/usr/bin/env node
/*
 * Static file server untuk men-serve folder docs/ (portal + simulator
 * tiap sheet) di Railway. Sengaja tanpa dependency eksternal (cuma
 * modul core Node: http, fs, path) supaya build di Railway cepat &
 * tidak tergantung registry npm.
 *
 * WAJIB listen di process.env.PORT — Railway inject port secara
 * dinamis per-deploy, bukan port tetap.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'docs');
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

const server = http.createServer(function (req, res) {
  let reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  // cegah path traversal (../) — resolve lalu pastikan masih di dalam ROOT
  const filePath = path.normalize(path.join(ROOT, reqPath));
  if (!filePath.startsWith(ROOT)) {
    return send404(res);
  }

  fs.stat(filePath, function (err, stats) {
    if (err) return send404(res);

    let finalPath = filePath;
    if (stats.isDirectory()) {
      finalPath = path.join(filePath, 'index.html');
    }

    fs.readFile(finalPath, function (readErr, content) {
      if (readErr) return send404(res);
      const ext = path.extname(finalPath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(content);
    });
  });
});

server.listen(PORT, HOST, function () {
  console.log('Simulator SIS jalan di http://' + HOST + ':' + PORT + ' (serving ' + ROOT + ')');
});
