#!/usr/bin/env python3
"""Summarise recorded QA results (qa-results/*.json) by QA area.

Reads the Vitest and Playwright JSON reports written by the "QA results" workflow and prints,
for each area, how many tests passed, failed, were flaky (passed only on retry) or were skipped,
plus the full list of failures. Only results that are in the files are counted: nothing is
assumed to have passed.

Usage: python3 scripts/qa-summary.py qa-results [--markdown]
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# Which QA areas each test file covers. A file can count towards several areas.
FILE_AREAS = {
    'auth.e2e.spec.ts': ['Authentication'],
    'auth-units.spec.ts': ['Authentication'],
    'access.e2e.spec.ts': ['Roles and permissions'],
    'qa-roles.spec.ts': ['Roles and permissions'],
    'route-access.spec.ts': ['Roles and permissions', 'Security controls'],
    'platform-dashboard.e2e.spec.ts': ['Organisation onboarding'],
    'control-centre.spec.ts': ['Organisation onboarding'],
    'tenancy.e2e.spec.ts': ['Tenant isolation'],
    'portal.e2e.spec.ts': ['Branding'],
    'portal.spec.ts': ['Branding'],
    'branding.test.ts': ['Branding'],
    'portal.test.ts': ['Branding'],
    'documents.e2e.spec.ts': ['Constitution upload', 'Text extraction', 'Content approval', 'Version management'],
    'documents-units.spec.ts': ['Text extraction'],
    'documents.spec.ts': ['Constitution upload', 'Content approval'],
    'approved-answers.e2e.spec.ts': ['Content approval'],
    'approved-answers.spec.ts': ['Content approval'],
    'answer-checks.spec.ts': ['Content approval'],
    'simple-words.e2e.spec.ts': ['Content approval', 'Version management'],
    'simple-words.spec.ts': ['Content approval'],
    'search.e2e.spec.ts': ['Search'],
    'search-reader.spec.ts': ['Search'],
    'references.spec.ts': ['Search'],
    'ai.e2e.spec.ts': ['AI answers and citations'],
    'ai-units.spec.ts': ['AI answers and citations'],
    'ask.spec.ts': ['AI answers and citations'],
    'clause-finder.spec.ts': ['AI answers and citations'],
    'subscriptions.e2e.spec.ts': ['Subscription entitlements'],
    'access.spec.ts': ['Subscription entitlements'],
    'billing.spec.ts': ['Subscription entitlements'],
    'offline.e2e.spec.ts': ['Online/offline'],
    'offline.spec.ts': ['Online/offline'],
    'offline.test.ts': ['Online/offline'],
    'app.e2e.spec.ts': ['Error handling'],
    'request-id.spec.ts': ['Error handling'],
    'api.test.ts': ['Error handling'],
    'security.e2e.spec.ts': ['Security controls'],
    'security-units.spec.ts': ['Security controls'],
    'security-headers.spec.ts': ['Security controls'],
    'security-headers.test.ts': ['Security controls'],
    'config.spec.ts': ['Security controls'],
}
# Areas recognised from test names, wherever the test lives.
TITLE_AREAS = [
    (re.compile(r'audit', re.I), 'Audit logs'),
    (re.compile(r'phone|mobile|small screen', re.I), 'Mobile responsiveness'),
    (re.compile(r'accessib', re.I), 'Accessibility'),
    (re.compile(r'tenant|another organisation|other organisation|netball|cross-', re.I), 'Tenant isolation'),
    (re.compile(r'error|not found|refus|invalid|wrong', re.I), 'Error handling'),
]
QA_FILE_TITLE_AREAS = {
    'qa-tenancy-errors.spec.ts': lambda title: ['Tenant isolation'] if 'tenant isolation' in title.lower() else ['Error handling'],
    'qa-mobile-accessibility.spec.ts': lambda title: ['Accessibility'] if 'accessib' in title.lower() else ['Mobile responsiveness'],
}

AREAS = [
    'Authentication', 'Roles and permissions', 'Organisation onboarding', 'Tenant isolation',
    'Branding', 'Constitution upload', 'Text extraction', 'Content approval', 'Version management',
    'Search', 'AI answers and citations', 'Subscription entitlements', 'Online/offline',
    'Mobile responsiveness', 'Error handling', 'Accessibility', 'Security controls', 'Audit logs',
]


def areas_for(file_name, title):
    found = list(FILE_AREAS.get(file_name, []))
    if file_name in QA_FILE_TITLE_AREAS:
        found += QA_FILE_TITLE_AREAS[file_name](title)
    for pattern, area in TITLE_AREAS:
        if pattern.search(title) and area not in found:
            found.append(area)
    return found or ['Other']


def vitest_results(path):
    data = json.loads(path.read_text())
    for suite in data.get('testResults', []):
        file_name = Path(suite['name']).name
        for test in suite.get('assertionResults', []):
            status = {'passed': 'passed', 'failed': 'failed'}.get(test['status'], 'skipped')
            message = ' '.join(test.get('failureMessages') or [])[:300]
            yield file_name, test['fullName'], status, message, 'unit/API'


def playwright_results(path):
    data = json.loads(path.read_text())

    def walk(suite, prefix):
        title = suite.get('title', '')
        here = prefix + ([title] if title and not title.endswith('.ts') else [])
        for spec in suite.get('specs', []):
            file_name = Path(spec.get('file', suite.get('file', ''))).name
            for test in spec.get('tests', []):
                outcome = test.get('status')  # expected | unexpected | flaky | skipped
                status = {'expected': 'passed', 'unexpected': 'failed', 'flaky': 'flaky'}.get(outcome, 'skipped')
                errors = [r.get('error', {}).get('message', '') for r in test.get('results', []) if r.get('error')]
                message = re.sub(r'\x1b\[[0-9;]*m', '', ' '.join(errors))[:300]
                yield file_name, ' › '.join(here + [spec['title']]), status, message, 'browser'
        for child in suite.get('suites', []):
            yield from walk(child, here)

    for suite in data.get('suites', []):
        yield from walk(suite, [])


def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else 'qa-results')
    rows = []
    for path in sorted(folder.glob('vitest-*.json')):
        rows += list(vitest_results(path))
    if (folder / 'playwright.json').exists():
        rows += list(playwright_results(folder / 'playwright.json'))

    totals = defaultdict(int)
    by_area = defaultdict(lambda: defaultdict(int))
    by_kind = defaultdict(lambda: defaultdict(int))
    failures = []
    for file_name, title, status, message, kind in rows:
        totals[status] += 1
        by_kind[kind][status] += 1
        for area in areas_for(file_name, title):
            by_area[area][status] += 1
        if status in ('failed', 'flaky'):
            failures.append((status, kind, file_name, title, message))

    print(f"Total tests recorded: {len(rows)}  " + '  '.join(f'{k}={v}' for k, v in sorted(totals.items())))
    for kind, counts in by_kind.items():
        print(f"  {kind}: " + '  '.join(f'{k}={v}' for k, v in sorted(counts.items())))
    print()
    print('| Area | Passed | Failed | Flaky | Skipped |')
    print('| --- | --- | --- | --- | --- |')
    for area in AREAS + ['Other']:
        counts = by_area.get(area)
        if not counts:
            print(f'| {area} | 0 | 0 | 0 | 0 |')
            continue
        print(f"| {area} | {counts['passed']} | {counts['failed']} | {counts['flaky']} | {counts['skipped']} |")
    print()
    for status, kind, file_name, title, message in failures:
        print(f'- {status.upper()} [{kind}] {file_name}: {title}\n    {message}')
    exit_codes = folder / 'exit-codes.txt'
    if exit_codes.exists():
        print('\nExit codes:\n' + exit_codes.read_text())


if __name__ == '__main__':
    main()
