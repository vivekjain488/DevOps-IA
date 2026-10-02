const { EventEmitter } = require('events');
jest.mock('https', () => ({ request: jest.fn() }));
const https = require('https'); const { executeSearch, getDashboardData } = require('../splunk');
beforeEach(() => { process.env.SPLUNK_REST_URL = 'https://127.0.0.1:8089'; process.env.SPLUNK_REST_TOKEN = 'masked'; https.request.mockImplementation((options, callback) => { const request = new EventEmitter(); request.write = jest.fn(); request.end = jest.fn(() => { const response = new EventEmitter(); response.statusCode = 200; response.setEncoding = jest.fn(); callback(response); response.emit('data', '{"preview":true,"result":{"requests":"0"}}\n{"preview":false,"result":{"requests":"4"}}\n'); response.emit('end'); }); return request; }); });
afterEach(() => { delete process.env.SPLUNK_REST_URL; delete process.env.SPLUNK_REST_TOKEN; jest.clearAllMocks(); });
test('exports JSON search results using a bearer token', async () => { await expect(executeSearch('search index=container_logs')).resolves.toEqual([{ requests: '4' }]); expect(https.request.mock.calls[0][0].headers.Authorization).toBe('Bearer masked'); });
test('creates the dashboard data from approved aggregate searches', async () => { const result = await getDashboardData(); expect(result.summary).toEqual({ requests: '4' }); expect(result.routes).toEqual([{ requests: '4' }]); expect(https.request).toHaveBeenCalledTimes(4); });
