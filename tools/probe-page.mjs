// Ask the running harness page which client modules it was told to load.
//
// Why: a plugin's host half can be perfectly healthy while its browser half is
// missing from the page's module list entirely, and the harness log cannot show
// that — the module list is composed into the page at boot. This reads it.
//
// The access token is read from the harness log at run time and never written
// anywhere: it is a credential, and it is the reason .web-url.txt is gitignored.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '..', 'logs', 'harness.log');

/** The most recent "dsh web: <url>" line, which carries the session token. */
function latestWebUrl() {
  const lines = readFileSync(LOG, 'utf8').split('\n').filter((line) => line.includes('dsh web: http'));
  if (lines.length === 0) throw new Error('no "dsh web:" line in the harness log');
  const match = lines[lines.length - 1].match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/);
  if (match === null) throw new Error('could not read the url and token');
  return match[0];
}

const url = latestWebUrl();
console.log(`harness at ${url.replace(/token=.*/, 'token=***')}`);

// The token is exchanged for a session cookie, exactly as a browser would.
const first = await fetch(url, { redirect: 'manual' });
const cookie = (first.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ');
console.log(`token exchange -> ${first.status}, cookie ${cookie === '' ? 'MISSING' : 'obtained'}`);

const origin = new URL(url).origin;
const page = await fetch(`${origin}/`, { headers: { cookie } });
const html = await page.text();
console.log(`page -> ${page.status}, ${html.length} bytes`);

// The module system batches client bundles into one request of the form
// /plugins/??a/client.js,b/client.js, so the ids have to be pulled out of that.
const ids = new Set();
for (const match of html.matchAll(/plugins\/\?\?([^"'&]+)/g)) {
  for (const part of match[1].split(',')) {
    const id = part.replace(/\/client\.js.*$/, '').trim();
    if (id !== '') ids.add(decodeURIComponent(id));
  }
}
for (const match of html.matchAll(/plugins\/([^/"'?]+)\/client\.js/g)) ids.add(decodeURIComponent(match[1]));

console.log(`\nclient modules the page was told to load: ${ids.size}`);
const interesting = [...ids].filter((id) => /labrador|pet|sidebar|billing|market/.test(id));
console.log('of interest:', interesting.join(', ') || '(none)');
console.log('labrador present:', ids.has('dsh-labrador') || html.includes('dsh-labrador'));

// The raw boot payload, if the page carries one, settles the question.
const boot = html.match(/__DSH_BOOT__\s*=\s*(\{[\s\S]{0,400})/);
if (boot !== null) console.log(`\nboot payload begins: ${boot[1].slice(0, 300)}`);
