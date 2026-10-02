const { EventEmitter } = require('events');
jest.mock('https', () => ({ request: jest.fn() }));
const https = require('https'); const { executeSearch, getDashboardData, getLogs, buildLogQuery, dashboardSearches } = require('../splunk');
beforeEach(() => { process.env.SPLUNK_REST_URL = 'https://127.0.0.1:8089'; process.env.SPLUNK_REST_TOKEN = 'masked'; https.request.mockImplementation((options, callback) => { const request = new EventEmitter(); request.write = jest.fn(); request.end = jest.fn(() => { const response = new EventEmitter(); response.statusCode = 200; response.setEncoding = jest.fn(); callback(response); response.emit('data', '{"preview":true,"result":{"requests":"0"}}\n{"preview":false,"result":{"requests":"4"}}\n'); response.emit('end'); }); return request; }); });
afterEach(() => { delete process.env.SPLUNK_REST_URL; delete process.env.SPLUNK_REST_TOKEN; jest.clearAllMocks(); });
test('exports JSON search results using a bearer token', async () => { await expect(executeSearch('search index=container_logs')).resolves.toEqual([{ requests: '4' }]); expect(https.request.mock.calls[0][0].headers.Authorization).toBe('Bearer masked'); });
test('creates the dashboard data from approved aggregate searches', async () => { const result = await getDashboardData(); expect(result.summary).toEqual({ requests: '4' }); expect(result.routes).toEqual([{ requests: '4' }]); expect(https.request).toHaveBeenCalledTimes(Object.keys(dashboardSearches()).length); expect(result.range).toBe('24h'); expect(result.unavailable).toEqual([]); });

const respondWith = body => https.request.mockImplementation((options, callback) => { const request = new EventEmitter(); request.write = jest.fn(); request.end = jest.fn(() => { const response = new EventEmitter(); response.statusCode = 200; response.setEncoding = jest.fn(); callback(response); response.emit('data', body(options)); response.emit('end'); }); return request; });
test('unknown dashboard ranges fall back to 24 hours', async () => { const result = await getDashboardData('1y; | delete'); expect(result.range).toBe('24h'); expect(https.request.mock.calls.length).toBeGreaterThan(0); });
test('supporting panels degrade instead of failing the dashboard', async () => {
  let call = 0; https.request.mockImplementation((options, callback) => { const index = call++; const request = new EventEmitter(); request.write = jest.fn(); request.end = jest.fn(() => { const response = new EventEmitter(); response.statusCode = index === 2 ? 200 : index > 2 ? 500 : 200; response.setEncoding = jest.fn(); callback(response); response.emit('data', '{"preview":false,"result":{"requests":"4"}}\n'); response.emit('end'); }); return request; });
  const result = await getDashboardData('1h'); expect(result.summary).toEqual({ requests: '4' }); expect(result.unavailable.length).toBeGreaterThan(0); expect(result.routes).toEqual([]);
});
test('log filters reject anything outside the allow-list', () => {
  expect(buildLogQuery({ level: 'nope' }).errors).toEqual(['level']);
  expect(buildLogQuery({ status: '6xx' }).errors).toEqual(['status']);
  expect(buildLogQuery({ q: 'x" | delete' }).errors).toEqual(['q']);
  expect(buildLogQuery({ path: '/api|x' }).errors).toEqual(['path']);
  expect(buildLogQuery({ limit: '9000' }).errors).toEqual(['limit']);
  const query = buildLogQuery({ level: 'error', status: '5xx', q: 'timeout db', path: '/api/events', range: '1h' });
  expect(query.errors).toEqual([]); expect(query.events).toContain('earliest=-1h "timeout" "db"'); expect(query.events).toContain('status>=500 AND status<600'); expect(query.events).toContain('like(path,"/api/events%")');
});
test('log search masks email addresses and returns facets', async () => {
  respondWith(() => '{"preview":false,"result":{"total":"2","msg":"failed for ada@example.com","level":"error"}}\n');
  const result = await getLogs({ range: '24h' }); expect(result.total).toBe(2); expect(result.events[0].msg).toBe('failed for [redacted-email]'); expect(result.levels).toHaveLength(1);
});
test('invalid log filters return errors without searching', async () => { await expect(getLogs({ level: 'bad' })).resolves.toEqual({ errors: ['level'] }); expect(https.request).not.toHaveBeenCalled(); });
