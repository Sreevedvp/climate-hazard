"""Pure, deterministic methodology. Missing observations never count as cool days."""
from datetime import date, timedelta
from statistics import mean
import math
from .models import AnalysisRequest, VERSION


def normalize(raw: dict, start: date, end: date):
    daily = raw.get('daily', {})
    unit = raw.get('daily_units', {}).get('temperature_2m_max')
    if unit not in ('°C', '°F'):
        raise ValueError('Unexpected temperature unit from provider')
    dates, values = daily.get('time', []), daily.get('temperature_2m_max', [])
    if len(dates) != len(values):
        raise ValueError('Provider date/value arrays differ in length')
    observed, duplicates = {}, set()
    for day, value in zip(dates, values):
        parsed = date.fromisoformat(day)
        if not start <= parsed <= end:
            continue
        if day in observed:
            duplicates.add(day)
        valid = type(value) in (int, float) and math.isfinite(value)
        celsius = ((value - 32) * 5 / 9 if unit == '°F' else value) if valid else None
        reason = 'missing' if celsius is None else 'outlier' if not -90 <= celsius <= 60 else None
        observed[day] = {'date': day, 'tmax': celsius if reason is None else None, 'issue': reason}
    rows = []
    while start <= end:
        key = start.isoformat()
        rows.append({'date': key, 'tmax': None, 'issue': 'duplicate'} if key in duplicates else observed.get(key, {'date': key, 'tmax': None, 'issue': 'missing'}))
        start += timedelta(days=1)
    return rows


def percentile(values, quantile=.95):
    ordered = sorted(values)
    index = (len(ordered) - 1) * quantile
    lo = int(index)
    return ordered[lo] + (ordered[min(lo + 1, len(ordered) - 1)] - ordered[lo]) * (index - lo)


def episodes(rows, threshold):
    result, run = [], []
    def flush():
        if len(run) >= 3:
            result.append({'start': run[0]['date'], 'end': run[-1]['date'], 'duration': len(run), 'peak_c': round(max(r['tmax'] for r in run), 2), 'mean_excess_c': round(mean(r['tmax'] - threshold for r in run), 2)})
    previous = None
    for row in sorted(rows, key=lambda r: r['date']):
        day = date.fromisoformat(row['date'])
        if previous is not None and day != previous + timedelta(days=1):
            flush(); run = []
        if row['tmax'] is not None and row['tmax'] > threshold:
            run.append(row)
        else:
            flush(); run = []
        previous = day
    flush()
    return result


def analyze(request: AnalysisRequest, rows: list[dict]):
    baseline = [r for r in rows if '1981-01-01' <= r['date'] <= '2010-12-31']
    expected = (date(2011, 1, 1) - date(1981, 1, 1)).days
    values = [r['tmax'] for r in baseline if r['tmax'] is not None]
    if len(values) / expected < .9:
        raise ValueError('Baseline has less than 90% valid coverage; no defensible threshold can be calculated')
    threshold = percentile(values)
    all_events = episodes(rows, threshold)
    for event in all_events:
        event['boundary_censored'] = event['start'] == rows[0]['date'] or event['end'] == rows[-1]['date']
    start, end = f'{request.start_year}-01-01', f'{request.end_year}-12-31'
    events = [e for e in all_events if e['end'] >= start and e['start'] <= end]
    annual = []
    for year in range(request.start_year, request.end_year + 1):
        first, last = date(year, 1, 1), date(year, 12, 31)
        year_rows = [r for r in rows if r['date'].startswith(str(year))]
        valid = sum(r['tmax'] is not None for r in year_rows)
        coverage = valid / ((last - first).days + 1)
        overlaps = [e for e in events if e['end'] >= first.isoformat() and e['start'] <= last.isoformat()]
        durations = [(min(last, date.fromisoformat(e['end'])) - max(first, date.fromisoformat(e['start']))).days + 1 for e in overlaps]
        annual.append({'year': year, 'coverage': round(coverage, 4), 'valid_days': valid, 'excluded_days': ((last-first).days+1)-valid,
            'eligible': coverage >= .9, 'events': sum(e['start'].startswith(str(year)) for e in events),
            'heatwave_days': sum(durations), 'longest_duration': max(durations, default=0),
            'peak_c': max((r['tmax'] for r in year_rows if r['tmax'] is not None), default=None)})
    for i, item in enumerate(annual):
        window = annual[max(0, i-4):i+1]
        item['rolling_days'] = round(mean(r['heatwave_days'] for r in window), 2) if len(window) == 5 and all(r['eligible'] for r in window) else None
    eligible = [r for r in annual if r['eligible']]
    slope = None
    if len(eligible) >= 10:
        xs, ys = [r['year'] for r in eligible], [r['heatwave_days'] for r in eligible]
        mx, my = mean(xs), mean(ys)
        slope = round(10 * sum((x-mx)*(y-my) for x, y in zip(xs, ys)) / sum((x-mx)**2 for x in xs), 3)
    comparison = None
    if len(annual) >= 10 and all(r['eligible'] for r in annual[:5] + annual[-5:]):
        early, late = mean(r['heatwave_days'] for r in annual[:5]), mean(r['heatwave_days'] for r in annual[-5:])
        comparison = {'early_mean_days': early, 'late_mean_days': late, 'absolute_change_days': round(late-early, 2), 'percent_change': round((late-early)/early*100, 1) if early else None, 'early_period': f'{annual[0]["year"]}–{annual[4]["year"]}', 'late_period': f'{annual[-5]["year"]}–{annual[-1]["year"]}'}
    issues = {kind: sum(r.get('issue') == kind for r in rows if start <= r['date'] <= end) for kind in ['missing', 'outlier', 'duplicate']}
    return {'methodology_version': VERSION, 'threshold_c': round(threshold, 4), 'baseline': '1981–2010', 'baseline_coverage': round(len(values)/expected, 4),
        'annual': annual, 'events': events, 'summary': {'events_starting_in_range': sum(start <= e['start'] <= end for e in events), 'heatwave_days': sum(r['heatwave_days'] for r in annual), 'eligible_years': len(eligible), 'slope_days_per_decade': slope, 'comparison': comparison},
        'quality': issues, 'warnings': ['Point-based ERA5 reanalysis, not station observations or a regional area average.', 'Fixed annual 95th percentile; this is a transparent screening definition, not an official local heat-health standard.', 'Trend is descriptive: no significance test, causal attribution, or autocorrelation correction.', 'Runs touching the outer observation boundary may be truncated; episode details flag these runs.'] + (['Some years have less than 90% coverage and are excluded from trend calculations.'] if len(eligible) < len(annual) else [])}
