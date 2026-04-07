// Quick test of the fixed fetch logic
const https = require('https');
const http = require('http');
const { URL } = require('url');

function fetchPage(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      timeout: 12000,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
      },
    };
    const r = mod.request(reqOpts, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        const next = new URL(response.headers.location, url).href;
        resolve(fetchPage(next, redirects + 1));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; if (body.length > 200000) response.destroy(); });
      response.on('end', () => resolve({ status: response.statusCode, html: body }));
      response.on('error', reject);
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  const urls = ['https://claude.ai','https://chat.openai.com','https://www.midjourney.com'];
  for (const url of urls) {
    console.log('\n---', url, '---');
    try {
      const { status, html } = await fetchPage(url);
      console.log('Status:', status, '| Length:', html.length);
      const patterns = [
        /meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
        /meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
        /meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
        /meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
      ];
      let desc = '';
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m && m[1] && m[1].length > 10) { desc = m[1].trim().slice(0, 150); break; }
      }
      console.log('Desc:', desc || '(none)');
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
})();
