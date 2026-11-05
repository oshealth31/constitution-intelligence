// k6 load test for the member portal (task T3). FICTIONAL data in a throwaway CI environment.
//
// Each virtual member signs in once, then repeatedly does what a member does: opens the home
// page, the library, the large constitution (all its clauses), and searches, with a few seconds
// of reading time in between. Requests go through the web app (as a browser's would).
//
//   SCENARIO=meeting   many members at one meeting, all on the SAME Wi-Fi (one address),
//                      signing in within about a minute; production limits.
//   SCENARIO=capacity  more and more members at once (25 → 50 → 100 → 200), to find where
//                      it slows down. Run with the per-address limits raised, so the server
//                      itself is measured rather than the flood guard.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const SLUG = __ENV.LOAD_SLUG || 'sample-community-choir';
const USERS = Number(__ENV.LOAD_USERS || 200);
const PASSWORD = __ENV.LOAD_PASSWORD;
const CONSTITUTION = __ENV.LOAD_CONSTITUTION_ID;
const VERSION = __ENV.LOAD_VERSION_ID;
const SCENARIO = __ENV.SCENARIO || 'capacity';

const refused = new Counter('refused_too_many_requests'); // 429
const serverErrors = new Counter('server_errors'); // 5xx
const otherErrors = new Counter('other_errors'); // other 4xx
const otherByStatus = {};
const loginRefused = new Counter('login_refused');
const loginTime = new Trend('step_login', true);
const homeTime = new Trend('step_home', true);
const readTime = new Trend('step_read_large_constitution', true);
const searchTime = new Trend('step_search', true);
const sectionsBytes = new Trend('large_constitution_bytes');

const scenarios = {
  meeting: {
    meeting: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '60s', target: 120 },
        { duration: '2m', target: 120 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  capacity: {
    capacity: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 25 },
        { duration: '1m', target: 25 },
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '1m30s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '1m30s', target: 200 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
};

export const options = {
  scenarios: scenarios[SCENARIO],
  // Keep each member's sign-in cookie between rounds (k6 clears it by default).
  noCookiesReset: true,
  // Recorded, not enforced: the numbers go into the report.
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max', 'count'],
  // Always-true thresholds: they make k6 keep the response times per load level for the report.
  thresholds: Object.fromEntries(
    ['25', '50', '100', '200'].map((value) => [`http_req_duration{level:${value}}`, ['max>=0']]),
  ),
};

const HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Origin: BASE, Accept: 'application/json' };
/** How many members are active right now, rounded up to the load levels 25/50/100/200. */
function level() {
  const active = exec.instance.vusActive;
  return String(active <= 25 ? 25 : active <= 50 ? 50 : active <= 100 ? 100 : 200);
}
function api() {
  return { headers: HEADERS, tags: { level: level() } };
}
function pageParams() {
  return { tags: { level: level() } };
}
const TERMS = ['quorum', 'treasurer', 'election', 'clause 250', 'annual general meeting', 'appeal'];

function count(response) {
  if (response.status === 429) refused.add(1);
  else if (response.status >= 500) serverErrors.add(1);
  else if (response.status >= 400 || response.status === 0) {
    otherErrors.add(1, { status: String(response.status) });
    const key = `${response.status} ${response.request.method} ${
      response.url
        .replace(/[0-9a-f-]{36}/g, ':id')
        .replace(BASE, '')
        .split('?')[0]
    }`;
    if (!otherByStatus[key]) {
      otherByStatus[key] = true;
      console.warn(`other error: ${key}`);
    }
  }
  return response;
}

const state = { signedIn: false, organisationId: null };

function signIn() {
  const email = `loadtest-${((__VU - 1) % USERS) + 1}@sample.test`;
  const started = Date.now();
  const response = count(
    http.post(
      `${BASE}/api/v1/auth/login`,
      JSON.stringify({ email, password: PASSWORD }),
      { headers: { ...HEADERS, 'Content-Type': 'application/json' }, tags: { level: level() } },
    ),
  );
  loginTime.add(Date.now() - started);
  if (response.status !== 200) {
    loginRefused.add(1);
    check(response, { 'signed in': () => false });
    return false;
  }
  const me = count(http.get(`${BASE}/api/v1/auth/me`, api()));
  const memberships = me.status === 200 ? me.json('memberships') || [] : [];
  state.organisationId = memberships.length > 0 ? memberships[0].organisationId : null;
  state.signedIn = Boolean(state.organisationId);
  check(response, { 'signed in': () => state.signedIn });
  return state.signedIn;
}

export default function () {
  if (!state.signedIn && !signIn()) {
    sleep(10); // as a person would wait before trying again
    return;
  }
  const org = `${BASE}/api/v1/organisations/${state.organisationId}`;

  group('home', () => {
    const started = Date.now();
    const page = count(http.get(`${BASE}/o/${SLUG}`, pageParams()));
    const responses = http.batch([
      ['GET', `${BASE}/api/v1/portal/${SLUG}`, null, api()],
      ['GET', `${BASE}/api/v1/auth/me`, null, api()],
      ['GET', `${org}/portal`, null, api()],
      ['GET', `${org}/ai/status`, null, api()],
    ]);
    responses.forEach(count);
    homeTime.add(Date.now() - started);
    check(page, { 'home page 200': (r) => r.status === 200 });
    check(responses[2], { 'portal home 200': (r) => r.status === 200 });
  });
  sleep(2 + Math.random() * 3);

  group('read the large constitution', () => {
    const started = Date.now();
    count(http.get(`${BASE}/o/${SLUG}/read/${CONSTITUTION}`, pageParams()));
    count(http.get(`${org}/library`, api()));
    count(http.get(`${org}/constitutions/${CONSTITUTION}`, api()));
    const sections = count(http.get(`${org}/versions/${VERSION}/sections`, api()));
    count(http.get(`${org}/simple-words?versionId=${VERSION}`, api()));
    readTime.add(Date.now() - started);
    if (sections.status === 200) sectionsBytes.add(sections.body.length);
    check(sections, { 'all clauses 200': (r) => r.status === 200 });
  });
  sleep(4 + Math.random() * 4);

  group('search', () => {
    const term = TERMS[Math.floor(Math.random() * TERMS.length)];
    const started = Date.now();
    const response = count(http.get(`${org}/search?q=${encodeURIComponent(term)}`, api()));
    searchTime.add(Date.now() - started);
    check(response, { 'search 200': (r) => r.status === 200 });
  });
  sleep(3 + Math.random() * 3);
}

export function handleSummary(data) {
  const metric = (name, stat) => {
    const values = data.metrics[name] && data.metrics[name].values;
    return values && values[stat] !== undefined ? values[stat] : 0;
  };
  // 429 responses are deliberate refusals, counted on their own line, not as failures here.
  const ms = (name) =>
    `p50 ${Math.round(metric(name, 'p(50)'))} ms · p95 ${Math.round(metric(name, 'p(95)'))} ms · p99 ${Math.round(metric(name, 'p(99)'))} ms · max ${Math.round(metric(name, 'max'))} ms`;
  const lines = [
    `## Load test: ${SCENARIO}`,
    '',
    `- Peak members at once: ${metric('vus_max', 'max')}`,
    `- Requests: ${metric('http_reqs', 'count')} (${metric('http_reqs', 'rate').toFixed(1)} per second)`,
    `- Failed requests: ${(metric('http_req_failed', 'rate') * 100).toFixed(2)} %`,
    `- Refused as "too many requests" (429): ${metric('refused_too_many_requests', 'count')}`,
    `- Server errors (5xx): ${metric('server_errors', 'count')}`,
    `- Other errors (4xx, timeouts): ${metric('other_errors', 'count')}`,
    `- Sign-ins refused: ${metric('login_refused', 'count')}`,
    `- Every request: ${ms('http_req_duration')}`,
    `- Sign in: ${ms('step_login')}`,
    `- Home page (page + 4 calls): ${ms('step_home')}`,
    `- Open the large constitution (page + 4 calls): ${ms('step_read_large_constitution')}`,
    `- Search: ${ms('step_search')}`,
    `- Large constitution download: ${Math.round(metric('large_constitution_bytes', 'avg') / 1024)} KB (uncompressed)`,
    '',
  ];
  const levels = ['25', '50', '100', '200'].filter(
    (value) => data.metrics[`http_req_duration{level:${value}}`],
  );
  if (levels.length > 1) {
    lines.push(
      '| Members at once | Requests | Typical (p50) | 95 % within | 99 % within |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const value of levels) {
      const values = data.metrics[`http_req_duration{level:${value}}`].values;
      lines.push(
        `| up to ${value} | ${values.count} | ${Math.round(values['p(50)'])} ms | ${Math.round(values['p(95)'])} ms | ${Math.round(values['p(99)'])} ms |`,
      );
    }
    lines.push('');
  }
  return {
    stdout: lines.join('\n') + '\n',
    [`load-${SCENARIO}.md`]: lines.join('\n') + '\n',
    [`load-${SCENARIO}.json`]: JSON.stringify(data, null, 2),
  };
}
