#!/usr/bin/env python3
"""Configure the local Splunk container from the ignored project .env file."""
import base64
import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
env = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines()
           if line and not line.startswith('#') and '=' in line)
context = ssl._create_unverified_context()
auth = base64.b64encode(('admin:' + env['SPLUNK_ADMIN_PASSWORD']).encode()).decode()

def request(path, data=None):
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request('https://127.0.0.1:8089' + path,
                                 data=body, headers={'Authorization': 'Basic ' + auth})
    with urllib.request.urlopen(req, context=context, timeout=10) as response:
        return response.read()

for attempt in range(180):
    try:
        request('/services/server/info?output_mode=json')
        break
    except (OSError, urllib.error.URLError):
        if attempt == 179:
            raise SystemExit('Splunk did not become ready within 15 minutes.')
        time.sleep(5)

for index in ('container_logs', 'container_metrics'):
    try:
        request('/services/data/indexes/' + index + '?output_mode=json')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        request('/services/data/indexes', {'name': index, 'datatype': 'event'})

prefix = '/servicesNS/admin/splunk_httpinput/data/inputs/http'
request(prefix + '/http', {'disabled': '0', 'enableSSL': '1', 'port': '8088'})
for name, key, index in (
    ('eventpulse-logs', 'SPLUNK_HEC_TOKEN', 'container_logs'),
    ('eventpulse-metrics', 'SPLUNK_METRICS_HEC_TOKEN', 'container_metrics'),
):
    values = {'token': env[key], 'index': index, 'indexes': index, 'disabled': '0'}
    try:
        request(prefix + '/' + name + '?output_mode=json')
        request(prefix + '/' + name, values)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        request(prefix, {'name': name, **values})
print('Configured container_logs, container_metrics, and both HEC tokens.')
