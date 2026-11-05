#!/usr/bin/env python3
"""Summarise OWASP ZAP JSON reports (task T5) and decide pass or fail.

Usage: zap-summary.py <accepted.tsv> <report.json> [<report.json> ...]

Fails (exit 1) on any High or Medium alert that is not listed in the accepted file with a
reason. Low and informational alerts are listed but never fail the check. Writes a Markdown
summary to stdout (for the job log and summary).
"""
import json
import sys

RISK = {'3': 'High', '2': 'Medium', '1': 'Low', '0': 'Informational'}


def load_accepted(path):
    accepted = {}
    with open(path, encoding='utf-8') as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            rule, _, reason = line.partition('\t')
            accepted[rule.strip()] = reason.strip()
    return accepted


def main():
    accepted = load_accepted(sys.argv[1])
    failing = []
    rows = []
    for path in sys.argv[2:]:
        try:
            with open(path, encoding='utf-8') as handle:
                report = json.load(handle)
        except FileNotFoundError:
            print(f'**Missing report: {path}** (the scan did not finish)')
            failing.append((path, 'missing report'))
            continue
        for site in report.get('site', []):
            for alert in site.get('alerts', []):
                rule = str(alert.get('pluginid'))
                risk = RISK.get(str(alert.get('riskcode')), '?')
                count = len(alert.get('instances', []))
                example = (alert.get('instances') or [{}])[0].get('uri', '')
                status = 'accepted' if rule in accepted else ''
                if risk in ('High', 'Medium') and rule not in accepted:
                    status = '**FAIL**'
                    failing.append((rule, alert.get('name')))
                rows.append((path, risk, rule, alert.get('name', ''), count, example, status,
                             accepted.get(rule, '')))
    order = {'High': 0, 'Medium': 1, 'Low': 2, 'Informational': 3}
    rows.sort(key=lambda row: (order.get(row[1], 9), row[0], row[2]))
    print('| Scan | Risk | Rule | Finding | Places | Example | Status | Reason if accepted |')
    print('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for row in rows:
        scan = row[0].replace('zap-', '').replace('.json', '')
        print(f'| {scan} | {row[1]} | {row[2]} | {row[3]} | {row[4]} | {row[5][:80]} | {row[6]} | {row[7]} |')
    print()
    if failing:
        print(f'**{len(failing)} High/Medium finding(s) not dealt with.**')
        sys.exit(1)
    print('No unexplained High or Medium findings.')


if __name__ == '__main__':
    main()
