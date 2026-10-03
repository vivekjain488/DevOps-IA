const { postToHec } = require('./hec');

function startProcessMetrics(intervalMs = 10000) {
  if (!process.env.SPLUNK_METRICS_HEC_TOKEN) return () => {};
  let lastUsage = process.cpuUsage(), lastTime = process.hrtime.bigint();
  const send = () => {
    const nowUsage = process.cpuUsage(), nowTime = process.hrtime.bigint();
    const elapsedMs = Number(nowTime - lastTime) / 1e6;
    const cpuMs = (nowUsage.user - lastUsage.user + nowUsage.system - lastUsage.system) / 1000;
    lastUsage = nowUsage; lastTime = nowTime;
    const memory = process.memoryUsage();
    void postToHec({
      time: Date.now() / 1000,
      event: { timestamp: new Date().toISOString(), metric_type: 'application_process_stats', service: process.env.SERVICE_NAME || 'docuflow-api', process_id: process.pid,
        process_status: 'running', uptime_seconds: Number(process.uptime().toFixed(2)), cpu_percent: Number(Math.max(0, (cpuMs / elapsedMs) * 100).toFixed(2)),
        memory_rss_bytes: memory.rss, memory_rss_mb: Number((memory.rss / 1048576).toFixed(2)), heap_used_bytes: memory.heapUsed, heap_used_mb: Number((memory.heapUsed / 1048576).toFixed(2)) },
      token: process.env.SPLUNK_METRICS_HEC_TOKEN, index: 'container_metrics', sourcetype: 'docuflow:application_metrics', source: process.env.SERVICE_NAME || 'docuflow-api'
    });
  };
  send(); const timer = setInterval(send, intervalMs); timer.unref(); return () => clearInterval(timer);
}
module.exports = { startProcessMetrics };
