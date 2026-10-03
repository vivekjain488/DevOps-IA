import os, time, logging
import docker, requests
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
# Comma-separated container names; DocuFlow watches the API and the processing worker.
TARGETS=[name.strip() for name in os.getenv('TARGET_CONTAINERS', os.getenv('TARGET_CONTAINER','docuflow-api,docuflow-worker')).split(',') if name.strip()]
URL=os.getenv('SPLUNK_HEC_URL',''); TOKEN=os.getenv('SPLUNK_METRICS_HEC_TOKEN',''); INTERVAL=int(os.getenv('SAMPLE_SECONDS','10'))
client=docker.from_env(); previous={}
def number(v): return round(float(v),2)
def send(event):
    payload={'time':time.time(),'event':event,'index':'container_metrics','sourcetype':'docuflow:container_metrics','source':'metrics-agent'}
    for delay in (1,2,4):
        try:
            r=requests.post(URL,json=payload,headers={'Authorization':f'Splunk {TOKEN}'},verify=False,timeout=8)
            if r.ok: return
            logging.warning('HEC returned status %s',r.status_code)
        except requests.RequestException as exc: logging.warning('HEC request failed: %s',exc)
        time.sleep(delay)
def sample(target):
    try: c=client.containers.get(target)
    except docker.errors.NotFound:
        send({'timestamp':datetime.now(timezone.utc).isoformat(),'metric_type':'container_stats','container_name':target,'container_status':'not_found'}); return
    try:
        c.reload(); base={'timestamp':datetime.now(timezone.utc).isoformat(),'metric_type':'container_stats','container_name':c.name,'container_id':c.short_id,'container_status':c.status,'restart_count':c.attrs['RestartCount']}
        if c.status!='running':
            previous.pop(target,None); send(base); return
        stats=c.stats(stream=False); cpu=stats.get('cpu_stats',{}); precpu=stats.get('precpu_stats',{})
        usage=cpu.get('cpu_usage',{}).get('total_usage',0)-precpu.get('cpu_usage',{}).get('total_usage',0); sys=cpu.get('system_cpu_usage',0)-precpu.get('system_cpu_usage',0)
        cpus=cpu.get('online_cpus') or len(cpu.get('cpu_usage',{}).get('percpu_usage',[])) or 1; cpu_pct=number((usage/sys)*cpus*100) if usage>0 and sys>0 else 0
        mem=stats.get('memory_stats',{}); memuse=mem.get('usage',0); limit=mem.get('limit',0); networks=stats.get('networks',{})
        rx=sum(x.get('rx_bytes',0) for x in networks.values()); tx=sum(x.get('tx_bytes',0) for x in networks.values()); now=time.time()
        rxrate=txrate=0; last=previous.get(target)
        if last:
            elapsed=now-last['time']; rxrate=number(max(0,rx-last['rx'])/elapsed); txrate=number(max(0,tx-last['tx'])/elapsed)
        previous[target]={'time':now,'rx':rx,'tx':tx}
        send({**base,'cpu_percent':cpu_pct,'memory_usage_bytes':memuse,'memory_usage_mb':number(memuse/(1024*1024)),'memory_limit_bytes':limit,'memory_percent':number(memuse/limit*100) if limit else 0,'network_rx_bytes':rx,'network_tx_bytes':tx,'network_rx_rate_bytes_per_second':rxrate,'network_tx_rate_bytes_per_second':txrate})
    except Exception as exc: logging.error('Docker statistics error for %s: %s',target,exc)
logging.info('Watching containers: %s',', '.join(TARGETS))
while True:
    for target in TARGETS: sample(target)
    time.sleep(INTERVAL)
