"""Opt-in tests against a real local MongoDB. Never use a production database."""
import os
import time
import uuid
from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.provider import WeatherProvider

pytestmark = pytest.mark.skipif(os.getenv('MONGO_TEST') != '1', reason='Set MONGO_TEST=1 with a local MongoDB running')

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('MONGO_DB','test_climate_'+uuid.uuid4().hex)
    monkeypatch.delenv('REDIS_URL',raising=False)
    calls=[]
    async def weather(_self,request,first,last):
        calls.append((first,last))
        day=date(first,1,1); rows=[]
        while day<=date(last,12,31):
            rows.append({'date':day.isoformat(),'tmax':40 if day.month==5 and day.day<=4 else 20,'issue':None})
            day+=timedelta(days=1)
        return rows,{'latitude':request.latitude,'longitude':request.longitude,'model':'TEST FIXTURE','url':'https://example.invalid'}
    monkeypatch.setattr(WeatherProvider,'weather',weather)
    with TestClient(app) as c:
        yield c,calls
    # Separate sync client avoids using the app's closed async event loop.
    from pymongo import MongoClient
    with MongoClient(os.getenv('MONGO_URL','mongodb://127.0.0.1:27017')) as mongo:
        mongo.drop_database(os.environ['MONGO_DB'])


def test_complete_persisted_job_idempotency_cache_and_export(client):
    c,calls=client
    body={'latitude':28,'longitude':77,'start_year':2000,'end_year':2010}
    submitted=c.post('/api/analyses',json=body)
    assert submitted.status_code==202
    key=submitted.json()['id']
    assert c.post('/api/analyses',json=body).json()['id']==key
    for _ in range(60):
        response=c.get('/api/analyses/'+key)
        if response.json()['status'] in ['completed','failed']:break
        time.sleep(.05)
    result=response.json()
    assert result['status']=='completed',result
    assert result['result']['summary']['heatwave_days']==44
    count=len(calls)
    assert c.post('/api/analyses',json=body).json()['status']=='completed'
    assert len(calls)==count
    events=c.get(f'/api/analyses/{key}/events?limit=2').json()
    assert len(events['items'])==2 and events['total']==11
    export=c.get(f'/api/analyses/{key}/export.csv')
    assert export.status_code==200 and 'heatwave_days' in export.text
    assert c.get('/api/analyses/not-a-hash').status_code==422
    assert c.get('/api/analyses/'+'0'*64).status_code==404
    assert c.get('/openapi.json').status_code==200 and c.get('/docs').status_code==200


def test_validation_and_rate_limit(client):
    c,_=client
    assert c.post('/api/analyses',content='x'*17000).status_code==413
    assert c.post('/api/analyses',json={'latitude':100,'longitude':0,'start_year':2020,'end_year':2000}).status_code==422
    body={'latitude':0,'longitude':0,'start_year':2000,'end_year':2010}
    for _ in range(6):assert c.post('/api/analyses',json=body).status_code==202
    response=c.post('/api/analyses',json=body)
    assert response.status_code==429 and response.headers['retry-after']=='60'
