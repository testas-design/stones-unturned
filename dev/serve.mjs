// Local dev server: serves the app and a tiny fake of the GitHub "contents" API
// backed by a folder on disk, so the real sync code can be tested offline.
//   node dev/serve.mjs --data <folder> [--port 8790]
// Then open http://localhost:8790/?api=http://localhost:8790 and connect with any token.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null)).filter(Boolean));
const PORT = +(args.port || 8790);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.resolve(args.data || '');
if (!args.data || !fs.existsSync(DATA)) { console.error('Pass --data <folder>'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS' };
const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors, ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/?(.*))?$/);
  if (m) {
    const file = decodeURIComponent(m[3] || '');
    if (m[3] === undefined) return send(res, 200, { full_name: `${m[1]}/${m[2]}`, permissions: { push: true } });
    if (req.method === 'GET' && !file) {
      return send(res, 200, fs.readdirSync(DATA).filter((f) => fs.statSync(path.join(DATA, f)).isFile())
        .map((f) => ({ type: 'file', path: f, sha: blobSha(fs.readFileSync(path.join(DATA, f))) })));
    }
    const fp = path.join(DATA, file);
    if (!fp.startsWith(DATA)) return send(res, 400, { message: 'bad path' });
    if (req.method === 'GET') {
      if (!fs.existsSync(fp)) return send(res, 404, { message: 'Not Found' });
      const buf = fs.readFileSync(fp);
      if ((req.headers.accept || '').includes('raw')) return send(res, 200, buf.toString('utf8'), { 'Content-Type': 'text/plain' });
      return send(res, 200, { type: 'file', path: file, sha: blobSha(buf), encoding: 'base64', content: buf.toString('base64') });
    }
    if (req.method === 'PUT') {
      let body = ''; for await (const c of req) body += c;
      const j = JSON.parse(body);
      const cur = fs.existsSync(fp) ? blobSha(fs.readFileSync(fp)) : null;
      if (cur && j.sha !== cur) return send(res, 409, { message: `${file} does not match ${j.sha}` });
      const buf = Buffer.from(j.content, 'base64');
      fs.writeFileSync(fp, buf);
      console.log(`PUT ${file} (${buf.length} bytes) — ${j.message}`);
      return send(res, 200, { content: { path: file, sha: blobSha(buf) } });
    }
  }
  let p = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`Stones Unturned dev: http://localhost:${PORT}/?api=http://localhost:${PORT}  (data: ${DATA})`));
