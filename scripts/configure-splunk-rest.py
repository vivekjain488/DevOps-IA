#!/usr/bin/env python3
"""Create a restricted Splunk search account and renew its 90-day token."""
import base64,json,secrets,ssl,urllib.request,urllib.parse,urllib.error
from pathlib import Path
p=Path(__file__).resolve().parents[1] / '.env';env=dict(l.split('=',1) for l in p.read_text().splitlines() if '=' in l and not l.startswith('#'))
auth=base64.b64encode(('admin:'+env['SPLUNK_ADMIN_PASSWORD']).encode()).decode()
def req(path,data=None):
 r=urllib.request.Request('https://127.0.0.1:8089'+path+'?output_mode=json',data=urllib.parse.urlencode(data,doseq=True).encode() if data is not None else None,headers={'Authorization':'Basic '+auth})
 try:
  with urllib.request.urlopen(r,context=ssl._create_unverified_context(),timeout=30) as x:return json.load(x)
 except urllib.error.HTTPError as e:
  print('API error',e.code,e.read().decode()[:500]);raise
req('/services/admin/token-auth/tokens_auth',{'disabled':'false'})
role='docuflow_reader';user='docuflow_dashboard'
roles=req('/services/authorization/roles')['entry']
if not any(x['name']==role for x in roles):
 req('/services/authorization/roles',{'name':role,'capabilities':['search'],'srchIndexesAllowed':['container_logs','container_metrics'],'srchIndexesDefault':['container_logs','container_metrics'],'srchJobsQuota':3,'rtSrchJobsQuota':0})
users=req('/services/authentication/users')['entry']
if not any(x['name']==user for x in users):req('/services/authentication/users',{'name':user,'password':secrets.token_urlsafe(32),'roles':role})
r=req('/services/authorization/tokens',{'name':user,'audience':'DocuFlow observability','expires_on':'+90d'})
token=r['entry'][0]['content']['token']
updates={'SPLUNK_REST_URL':'https://127.0.0.1:8089','SPLUNK_REST_TOKEN':token,'SPLUNK_REST_INSECURE_TLS':'true'}
lines=p.read_text().splitlines();lines=[l for l in lines if l.split('=',1)[0] not in updates];lines.extend(k+'='+v for k,v in updates.items());p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
print('Configured restricted search user and 90-day REST token in .env.')
