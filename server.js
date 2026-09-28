#!/usr/bin/env node
/* ReviewPilot AI — tiny zero-dependency Node server.
 * Serves the dashboard + shareable review-request page, and drafts
 * review replies. Drafting works fully offline via local templates;
 * if OPENAI_API_KEY is set, replies are optionally polished by OpenAI
 * (never required).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const RP = require('./lib/logic');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ROOT = __dirname;
const VERSION = '1.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveFile(res, relPath) {
  const abs = path.normalize(path.join(ROOT, relPath));
  if (!abs.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  fs.readFile(abs, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(data);
  });
}

function send(res, code, body, type) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; if (chunks.length > 200000) req.destroy(); });
    req.on('end', () => resolve(chunks));
    req.on('error', reject);
  });
}

// Optional OpenAI polish: takes local drafts, returns improved ones.
// Any failure -> caller falls back to local templates.
async function openaiPolish(drafts, ctx) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt =
    'You polish customer-review reply drafts for a local business. ' +
    'Keep each under 60 words, warm, specific, no placeholders. ' +
    'Business: ' + ctx.business + '. Stars: ' + ctx.stars + '. ' +
    'Reviewer: ' + (ctx.name || 'customer') + '. Review: "' + ctx.review.slice(0, 500) + '"\n' +
    'Return ONLY valid JSON: {"professional":"...","friendly":"...","witly":"..."}';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400
      })
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content;
    if (!text) return null;
    const parsed = JSON.parse(text.replace(/^```json|```$/g, '').trim());
    if (parsed.professional && parsed.friendly && (parsed.witty || parsed.witly)) {
      return {
        professional: String(parsed.professional),
        friendly: String(parsed.friendly),
        witty: String(parsed.witty || parsed.witly)
      };
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, version: VERSION });
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, {
        openai: Boolean(process.env.OPENAI_API_KEY),
        version: VERSION
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/draft-reply') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, 400, { error: 'Invalid JSON body' });
      }
      const ctx = {
        review: RP.clean(body.review),
        stars: RP.clampStars(body.stars),
        business: RP.clean(body.business) || 'our business',
        name: RP.clean(body.name)
      };
      const local = RP.draftReplies(ctx);
      let tones = { professional: local.professional, friendly: local.friendly, witty: local.witty };
      let enhanced = false;
      const polished = await openaiPolish(tones, ctx);
      if (polished) { tones = polished; enhanced = true; }
      return send(res, 200, { tones, enhanced, meta: local.meta });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return serveFile(res, 'public/index.html');
    }
    if (req.method === 'GET' && url.pathname === '/ask') {
      return serveFile(res, 'public/ask.html');
    }
    if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
      return serveFile(res, url.pathname.slice(1));
    }
    if (req.method === 'GET' && url.pathname === '/lib/logic.js') {
      return serveFile(res, 'lib/logic.js');
    }

    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log('ReviewPilot AI listening on http://localhost:' + PORT);
});
