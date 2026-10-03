#!/usr/bin/env python3
"""Create or update the DocuFlow dashboard using Splunk's REST API, then check every panel search runs."""
import base64
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
env = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines()
           if line and not line.startswith('#') and '=' in line)
auth = base64.b64encode(('admin:' + env['SPLUNK_ADMIN_PASSWORD']).encode()).decode()
context = ssl._create_unverified_context()

def request(path, data=None):
    req = urllib.request.Request('https://127.0.0.1:8089' + path,
        data=urllib.parse.urlencode(data).encode() if data is not None else None,
        headers={'Authorization': 'Basic ' + auth})
    with urllib.request.urlopen(req, context=context, timeout=60) as response:
        return response.read()

name = 'docuflow_observability'
endpoint = '/servicesNS/admin/search/data/ui/views'
xml = (root / 'splunk/docuflow_dashboard.xml').read_text()
try:
    request(endpoint + '/' + name + '?output_mode=json')
    request(endpoint + '/' + name, {'eai:data': xml})
except urllib.error.HTTPError as error:
    if error.code != 404:
        raise
    request(endpoint, {'name': name, 'eai:data': xml})
saved = json.loads(request(endpoint + '/' + name + '?output_mode=json'))
assert saved['entry'][0]['content']['eai:data'].strip() == xml.strip()
print('Dashboard deployed: http://localhost:8000/en-GB/app/search/' + name)

if __name__ == '__main__':
    for panel in json.loads((root / 'splunk/dashboard_queries.json').read_text()):
        raw = request('/services/search/jobs/export', {
            'search': 'search ' + panel['query'], 'earliest_time': '-1h',
            'latest_time': 'now', 'output_mode': 'json'})
        records = [json.loads(line) for line in raw.decode().splitlines() if line]
        errors = [r for r in records if r.get('messages') and
                  any(m.get('type') in ('ERROR', 'FATAL') for m in r['messages'])]
        if errors:
            raise RuntimeError(panel['title'] + ': ' + json.dumps(errors))
        print(panel['title'] + ': ' + str(sum('result' in r for r in records)) + ' result rows')
