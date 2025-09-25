#!/usr/bin/env node
import http from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { createReadStream } from 'fs';
import { join, extname, resolve } from 'path';

const root = resolve(process.cwd(), 'public');
const port = process.env.PORT || 5173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath = join(root, urlPath === '/' ? '/index.html' : urlPath);
  if (!existsSync(filePath)) {
    // SPA fallback
    filePath = join(root, 'index.html');
  }
  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) filePath = join(filePath, 'index.html');
    const type = types[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Dev server running at http://localhost:${port}`);
});

