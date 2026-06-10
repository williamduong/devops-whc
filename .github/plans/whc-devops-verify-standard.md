# WHC DevOps Verify Standard (Simple)

Status: active
Owner: devops-whc
Last updated: 2026-06-10

## 1) Scope
This standard is for DevOps deployment verification only.

It is not a business/UAT test replacement.

Core rule:
1. Verify changes declared by release manifest (diff-driven).
2. Add small random sample as guardrail.

## 2) Release Manifest Format
Use one manifest file per release.

Required fields:
1. `release_id`
2. `target_environment`
3. `release_time_utc`
4. `file_changes`
5. `db_checks`
6. `config_checks`

Minimal example:

```json
{
  "release_id": "mytho-20260610-01",
  "target_environment": "staging",
  "release_time_utc": "2026-06-10T06:30:00Z",
  "file_changes": [
    {
      "path": "wordpress/wp-content/plugins/mytho-core/mytho-core.php",
      "expected_sha256": "<sha256>",
      "expected_size": 193235
    },
    {
      "path": "wordpress/wp-content/themes/mytho-child/style.css",
      "expected_sha256": "<sha256>",
      "expected_size": 244
    }
  ],
  "db_checks": [
    {
      "name": "products_count_min",
      "type": "sql_scalar",
      "query": "SELECT COUNT(*) FROM wp_posts WHERE post_type='product'",
      "operator": ">=",
      "expected": 1
    }
  ],
  "config_checks": [
    {
      "name": "active_theme",
      "type": "wp_option",
      "key": "stylesheet",
      "expected": "mytho-child"
    },
    {
      "name": "plugin_mytho_core_active",
      "type": "wp_plugin_active",
      "plugin": "mytho-core"
    }
  ]
}
```

## 3) Verify Report Format
One report per verification run.

Required fields:
1. `release_id`
2. `target_environment`
3. `started_at_utc`
4. `completed_at_utc`
5. `file_verification`
6. `db_verification`
7. `config_verification`
8. `health_verification`
9. `final_status`
10. `notes`

Minimal example:

```json
{
  "release_id": "mytho-20260610-01",
  "target_environment": "staging",
  "started_at_utc": "2026-06-10T06:31:00Z",
  "completed_at_utc": "2026-06-10T06:35:00Z",
  "file_verification": {
    "declared_total": 2,
    "declared_passed": 2,
    "random_sample_total": 3,
    "random_sample_passed": 3
  },
  "db_verification": {
    "checks_total": 1,
    "checks_passed": 1
  },
  "config_verification": {
    "checks_total": 2,
    "checks_passed": 2
  },
  "health_verification": {
    "http_root_ok": true,
    "wp_rest_ok": true,
    "critical_5xx_detected": false
  },
  "final_status": "PASS",
  "notes": []
}
```

## 4) Verification Steps (Simple)
1. Read release manifest.
2. Verify all declared changed files (path, size, hash, modified time).
3. Verify DB checks declared in manifest.
4. Verify config checks declared in manifest.
5. Run random sample guardrail for extra files.
6. Run health checks (`/`, `wp-json`, no new critical 5xx).
7. Generate verify report and final status.

## 5) Random Guardrail Rule
Keep this simple and reproducible:
1. Sample size: `max(3, ceil(10% of file_changes))`, capped at 20.
2. Seed: `release_id`.
3. Sample source: changed files not in critical list.

## 6) Fixed PASS/FAIL Criteria

PASS:
1. 100% declared files passed.
2. 100% DB checks passed.
3. 100% config checks passed.
4. Random sample pass rate >= 95%.
5. Health checks passed and no new critical 5xx.

PARTIAL:
1. Declared files passed, but one or more DB/config checks were skipped with explicit reason.

FAIL:
1. Any declared file failed.
2. Any required DB/config check failed.
3. Health check failed or critical 5xx detected.

## 7) DevOps vs QA Boundary
DevOps verify confirms deployment integrity.

QA/QC validates business behavior and acceptance criteria.