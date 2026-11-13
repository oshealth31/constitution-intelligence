# Operations

| Document                                                     | Covers                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [production-readiness.md](production-readiness.md)           | Go-live recommendation, readiness checklist, unresolved legal, privacy, security, hosting and operational requirements |
| [deployment.md](deployment.md)                               | Server layout, first installation, HTTPS requirements, releasing a new version                                         |
| [go-live-check.md](go-live-check.md)                         | Task S7: the evidence for each go-live condition, the restore test, the recovery keys, the owner's sign-off            |
| [oracle-cloud.md](oracle-cloud.md)                           | The production server on Oracle Cloud and the Deploy workflow (owner's step-by-step guide)                             |
| [database-migrations.md](database-migrations.md)             | Applying and writing migrations                                                                                        |
| [secrets.md](secrets.md)                                     | Creating, storing and rotating secrets                                                                                 |
| [logging-and-monitoring.md](logging-and-monitoring.md)       | Logs, health checks, monitoring and alert rules                                                                        |
| [backup-and-restore.md](backup-and-restore.md)               | Database and file backups, restore procedure, restore test record                                                      |
| [rollback.md](rollback.md)                                   | Going back to the previous version                                                                                     |
| [incident-response.md](incident-response.md)                 | What to do when something goes wrong, including breach notification                                                    |
| [two-step-sign-in.md](two-step-sign-in.md)                   | How staff and organisation administrators set up and use two-step sign-in; lost phones                                 |
| [maintenance.md](maintenance.md)                             | Routine tasks and maintenance windows                                                                                  |
| [onboarding.md](onboarding.md)                               | Setting up a new organisation                                                                                          |
| [offboarding-and-retention.md](offboarding-and-retention.md) | Leaving, data export, retention periods, deletion                                                                      |
| [audit-seal.md](audit-seal.md)                               | Daily seal of the audit log, off-site copy and check (tamper-evidence)                                                 |
| [data-requests.md](data-requests.md)                         | One person asking for a copy, correction or deletion of their data                                                     |

Files: `infra/production/` (images, Compose layout, HTTPS proxy, settings template) and `ops/`
(backup, restore, export, health check). Automated evidence: `.github/workflows/deployment-check.yml`.
