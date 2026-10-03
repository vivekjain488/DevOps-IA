jest.mock('../hec', () => ({ postToHec: jest.fn(() => Promise.resolve(true)) }));
const { postToHec } = require('../hec'); const { startProcessMetrics } = require('../metrics');
afterEach(() => { delete process.env.SPLUNK_METRICS_HEC_TOKEN; jest.useRealTimers(); jest.clearAllMocks(); });
test('sends process metrics immediately and on its sampling interval', () => {
  jest.useFakeTimers(); process.env.SPLUNK_METRICS_HEC_TOKEN = 'masked-token'; const stop = startProcessMetrics(10000);
  expect(postToHec).toHaveBeenCalledWith(expect.objectContaining({ index: 'container_metrics', sourcetype: 'docuflow:application_metrics', token: 'masked-token', event: expect.objectContaining({ metric_type: 'application_process_stats', process_status: 'running' }) }));
  jest.advanceTimersByTime(10000); expect(postToHec).toHaveBeenCalledTimes(2); stop();
});
test('does not create an interval without a metrics token', () => { expect(typeof startProcessMetrics()).toBe('function'); expect(postToHec).not.toHaveBeenCalled(); });
