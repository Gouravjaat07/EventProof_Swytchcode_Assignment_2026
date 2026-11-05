// EventProof dev-only transport relay (Phase 1 tooling, NOT shipped).
//
// Problem: this sandbox blocks direct outbound TCP from child processes.
// The Swytchcode CLI dials https://api-v2.swytchcode.com directly and does
// not honour the sandbox HTTP(S)_PROXY, so registry commands fail here.
//
// This relay accepts the CLI's plain-HTTP requests on 127.0.0.1 and forwards
// them byte-for-byte to the genuine Swytchcode backend over TLS through the
// sandbox proxy (HTTP CONNECT). It never fabricates, caches, or alters API
// payloads: it is a transparent transport adapter, equivalent to running the
// CLI behind a corporate proxy. All request/response bytes still terminate at
// the real backend; TLS is validated normally (rejectUnauthorized default).
//
// Usage:
//   RELAY_PORT=0 HTTPS_PROXY=<sandbox proxy> node tools/relay/relay.js
//   SWYTCHCODE_API_URL=http://127.0.0.1:<port> swy <registry-command>
//
// Logs only "METHOD path -> status" lines to stderr. Never logs headers or
// bodies (they may carry tokens).

'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const TARGET = new URL(process.env.RELAY_TARGET || 'https://api-v2.swytchcode.com');
const proxyRaw =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

if (!proxyRaw) {
  console.error('relay: no HTTPS_PROXY/HTTP_PROXY in environment; refusing to start');
  process.exit(2);
}
const proxy = new URL(proxyRaw);
const PORT = Number.parseInt(process.env.RELAY_PORT || '0', 10);
const MAX_BODY = 10 * 1024 * 1024;

// Open a TCP tunnel to TARGET through the proxy. Resolves with the raw
// socket positioned just past the CONNECT response headers.
function openTunnel() {
  return new Promise((resolve, reject) => {
    const targetHost = `${TARGET.hostname}:${TARGET.port || '443'}`;
    const sock = net.connect({ host: proxy.hostname, port: Number(proxy.port) || 80 });
    const fail = (err) => {
      sock.destroy();
      reject(err);
    };
    sock.setTimeout(20000, () => fail(new Error('proxy connect timeout')));
    sock.once('error', fail);
    let buf = '';
    sock.on('connect', () => {
      sock.write(
        `CONNECT ${targetHost} HTTP/1.1\r\nHost: ${targetHost}\r\nProxy-Connection: Keep-Alive\r\n\r\n`
      );
    });
    sock.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      if (buf.length > 65536) {
        fail(new Error('proxy CONNECT response too large'));
        return;
      }
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) return;
      const statusLine = buf.slice(0, buf.indexOf('\r\n'));
      const m = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
      if (!m || m[1] !== '200') {
        fail(new Error(`proxy CONNECT rejected: ${statusLine}`));
        return;
      }
      sock.removeAllListeners('data');
      sock.removeAllListeners('error');
      sock.setTimeout(0);
      const rest = buf.slice(end + 4);
      if (rest.length > 0) sock.unshift(Buffer.from(rest, 'latin1'));
      resolve(sock);
    });
  });
}

const server = http.createServer((req, res) => {
  const t0 = Date.now();
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ relay_error: 'request body too large' }));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    openTunnel().then(
      (sock) => {
        const headers = { ...req.headers };
        headers.host = TARGET.host;
        delete headers['proxy-connection'];
        headers.connection = 'close';
        const out = https.request(
          {
            host: TARGET.hostname,
            port: TARGET.port || 443,
            servername: TARGET.hostname,
            method: req.method,
            path: req.url,
            headers,
            // Hand the pre-connected tunnel socket to Node's TLS stack so
            // the response is parsed as a normal HTTPS response.
            createConnection: () => sock,
          },
          (back) => {
            res.writeHead(back.statusCode, back.headers);
            back.pipe(res);
            console.error(`relay: ${req.method} ${req.url} -> ${back.statusCode} (${Date.now() - t0}ms)`);
          }
        );
        out.setTimeout(60000, () => out.destroy(new Error('upstream timeout')));
        out.once('error', (err) => {
          console.error(`relay: ${req.method} ${req.url} -> upstream error: ${err.message}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ relay_error: String(err && err.message ? err.message : err) }));
          } else {
            res.end();
          }
        });
        if (body.length > 0) out.write(body);
        out.end();
      },
      (err) => {
        console.error(`relay: ${req.method} ${req.url} -> tunnel failed: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ relay_error: String(err && err.message ? err.message : err) }));
        }
      }
    );
  });
});

server.timeout = 90000;
server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  console.log(`RELAY_READY port=${addr.port} target=${TARGET.origin}`);
});
