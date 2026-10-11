from datetime import date, timedelta
import pytest
from app.climate import normalize, episodes, percentile, analyze
from app.models import AnalysisRequest


def rows(start, temperatures):
    return [{'date':(date.fromisoformat(start)+timedelta(days=i)).isoformat(),'tmax':t,'issue':None if t is not None else 'missing'} for i,t in enumerate(temperatures)]


def baseline(value=20):
    day=date(1981,1,1);result=[]
    while day < date(2011,1,1):
        result.append({'date':day.isoformat(),'tmax':value,'issue':None});day+=timedelta(days=1)
    return result


def test_threshold_strict_and_duration():
    assert episodes(rows('2020-01-01',[30,30,30]),30)==[]
    assert episodes(rows('2020-01-01',[31,31]),30)==[]
    assert episodes(rows('2020-01-01',[31,32,33]),30)[0]['duration']==3


def test_missing_day_breaks_run_and_cross_year_is_one_episode():
    assert episodes(rows('2020-01-01',[31,31,None,31,31]),30)==[]
    result=episodes(rows('2019-12-30',[31,32,33,34]),30)
    assert len(result)==1 and result[0]['end']=='2020-01-02'
    gap=rows('2020-01-01',[31,31])+rows('2020-01-04',[31])
    assert episodes(gap,30)==[]


def test_leap_day_and_unsorted_input():
    result=episodes(list(reversed(rows('2020-02-28',[31,32,33]))),30)
    assert result[0]['duration']==3 and result[0]['end']=='2020-03-01'


def test_normalization_units_gaps_outliers_duplicates():
    raw={'daily_units':{'temperature_2m_max':'°F'},'daily':{'time':['2020-01-01','2020-01-01','2020-01-03','2020-01-04'],'temperature_2m_max':[86,87,500,86]}}
    result=normalize(raw,date(2020,1,1),date(2020,1,4))
    assert [r['issue'] for r in result]==['duplicate','missing','outlier',None]
    assert result[-1]['tmax']==30


def test_bad_units_and_lengths_rejected():
    with pytest.raises(ValueError):normalize({'daily_units':{'temperature_2m_max':'K'}},date(2020,1,1),date(2020,1,1))
    with pytest.raises(ValueError):normalize({'daily_units':{'temperature_2m_max':'°C'},'daily':{'time':['2020-01-01'],'temperature_2m_max':[]}},date(2020,1,1),date(2020,1,1))


def test_percentile_linear_interpolation():
    assert percentile([0,10,20,30,40])==38


def test_cross_year_allocation_zero_change_and_fixed_baseline():
    request=AnalysisRequest(latitude=28,longitude=77,start_year=2000,end_year=2010)
    data=baseline()
    for row in data:
        if '2009-12-30'<=row['date']<='2010-01-02':row['tmax']=40
    result=analyze(request,data)
    assert result['threshold_c']==20
    assert result['annual'][-2]['events']==1 and result['annual'][-1]['events']==0
    assert result['annual'][-2]['heatwave_days']==2 and result['annual'][-1]['heatwave_days']==2
    assert result['summary']['comparison']['percent_change'] is None
    shorter=analyze(AnalysisRequest(latitude=28,longitude=77,start_year=2008,end_year=2010),data)
    assert shorter['threshold_c']==result['threshold_c']
    assert shorter['summary']['slope_days_per_decade'] is None


def test_incomplete_baseline_rejected():
    with pytest.raises(ValueError,match='Baseline'):
        analyze(AnalysisRequest(latitude=0,longitude=0,start_year=2000,end_year=2010),rows('2000-01-01',[20]*10))


def test_low_coverage_excluded_from_regression_and_rolling_mean():
    data=baseline()
    for row in data:
        if row['date'].startswith('2005'):row['tmax']=None;row['issue']='missing'
    result=analyze(AnalysisRequest(latitude=0,longitude=0,start_year=2000,end_year=2010),data)
    assert result['annual'][5]['eligible'] is False
    assert result['annual'][5]['rolling_days'] is None
    assert result['summary']['eligible_years']==10

@pytest.mark.parametrize('changes',[{'latitude':91},{'longitude':float('nan')},{'start_year':2020,'end_year':2010},{'start_year':1950,'end_year':2020},{'end_year':date.today().year}])
def test_invalid_requests(changes):
    values={'latitude':0,'longitude':0,'start_year':1990,'end_year':2020}|changes
    with pytest.raises(ValueError):AnalysisRequest(**values)


def test_canonical_keys():
    a=AnalysisRequest(latitude=28.61391,longitude=77.20901,start_year=1990,end_year=2020)
    b=AnalysisRequest(latitude=28.61392,longitude=77.20902,start_year=1990,end_year=2020)
    assert a.key==b.key
