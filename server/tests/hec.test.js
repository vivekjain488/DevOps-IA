const { EventEmitter } = require('events');
jest.mock('https', () => ({ request: jest.fn() }));
const https = require('https'); const { postToHec } = require('../hec');

afterEach(() => { delete process.env.SPLUNK_HEC_URL; delete process.env.SPLUNK_HEC_INSECURE_TLS; jest.clearAllMocks(); });
test('does nothing without a configured endpoint or token', async () => expect(await postToHec({ event: {} })).toBe(false));
test('posts a structured event to local HTTPS HEC', async () => {
  process.env.SPLUNK_HEC_URL = 'https://127.0.0.1:8088/services/collector/event'; process.env.SPLUNK_HEC_INSECURE_TLS = 'true';
  let options, written; https.request.mockImplementation((value, callback) => { options = value; const request = new EventEmitter(); request.write = jest.fn(body => { written = JSON.parse(body); }); request.end = jest.fn(() => callback({ statusCode: 200, resume: jest.fn() })); return request; });
  await expect(postToHec({ event: { service: 'docuflow-api' }, time: 1700000000.5, token: 'masked-token', index: 'container_logs', sourcetype: 'docuflow:application', source: 'docuflow-api' })).resolves.toBe(true);
  expect(options.headers.Authorization).toBe('Splunk masked-token'); expect(written).toMatchObject({ time: 1700000000.5, index: 'container_logs' }); expect(options.rejectUnauthorized).toBe(false);
});
