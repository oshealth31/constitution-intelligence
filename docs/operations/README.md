# Operations

| Document                                                     | Covers                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [production-readiness.md](production-readiness.md)           | Go-live recommendation, readiness checklist, unresolved legal, privacy, security, hosting and operational requirements |
| [deployment.md](deployment.md)                               | Server layout, first installation, HTTPS requirements, releasing a new version                                         |
| [database-migrations.md](database-migrations.md)             | Applying and writing migrations                                                                                        |
| [secrets.md](secrets.md)                                     | Creating, storing and rotating secrets                                                                                 |
| [logging-and-monitoring.md](logging-and-monitoring.md)       | Logs, health checks, monitoring and alert rules                                                                        |
| [backup-and-restore.md](backup-and-restore.md)               | Database and file backups, restore procedure, restore test record                                                      |
| [rollback.md](rollback.md)                                   | Going back to the previous version                                                                                     |
| [incident-response.md](incident-response.md)                 | What to do when something goes wrong, including breach notification                                                    |
| [maintenance.md](maintenance.md)                             | Routine tasks and maintenance windows                                                                                  |
| [onboarding.md](onboarding.md)                               | Setting up a new organisation                                                                                          |
| [offboarding-and-retention.md](offboarding-and-retention.md) | Leaving, data export, retention periods, deletion                                                                      |

Files: `infra/production/` (images, Compose layout, HTTPS proxy, settings template) and `ops/`
(backup, restore, export, health check). Automated evidence: `.github/workflows/deployment-check.yml`.
