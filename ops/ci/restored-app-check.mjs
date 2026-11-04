// Used by the deployment check workflow: signs in to an API started on a RESTORED database
// and checks that the restored data really works through the application (not just that the
// rows exist). Usage: node restored-app-check.mjs <email> <password>
const base = 'http://127.0.0.1:4000/api/v1';
const [email, password] = process.argv.slice(2);
const json = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' };

function fail(message) {
  console.error(`[restore-test] FAIL ${message}`);
  process.exit(1);
}

const ready = await fetch(`${base}/health/ready`);
if (!ready.ok) fail(`health/ready answered ${ready.status}`);
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: json,
  body: JSON.stringify({ email, password }),
});
if (login.status !== 200) fail(`sign-in answered ${login.status}`);
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
const me = await (await fetch(`${base}/auth/me`, { headers: { cookie } })).json();
const choir = me.memberships?.find((item) => item.organisationSlug === 'sample-community-choir');
if (!choir) fail('the restored account is not a member of the choir');
const api = `${base}/organisations/${choir.organisationId}`;
const constitutions = await (await fetch(`${api}/constitutions`, { headers: { cookie } })).json();
const count = Array.isArray(constitutions)
  ? constitutions.length
  : (constitutions.items ?? constitutions.constitutions ?? []).length;
if (!count) fail('no constitutions visible after restore');
const search = await (await fetch(`${api}/search?q=meeting`, { headers: { cookie } })).json();
const hits = (search.results ?? []).length;
if (!hits) fail('search found nothing after restore');
console.log(`[restore-test] ok signed in as ${email} on the restored database`);
console.log(`[restore-test] ok constitutions visible: ${count}; search "meeting" results: ${hits}`);
