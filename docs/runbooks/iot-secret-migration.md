# IoT tenant-secret migration runbook

**State:** prepared, not executed against production. Production backfill is an explicit operator action and remains a blocker until read-back confirms the legacy copies are gone.

## Scope

- Move non-empty `tenants/{tenantId}.iotSecret` values into `tenant_iot_secrets/{tenantId}.iotSecret`.
- Delete the legacy root field in the same Firestore transaction.
- Leave an existing matching protected value in place and clear the duplicate root field.
- If the destination contains a different or malformed key, report a conflict and change neither document.
- Never print key values. The script logs tenant document IDs and outcome labels for conflict triage; treat those IDs as internal operational metadata and keep the output in an authorized operations channel.
- `tenants/{tenantId}/iot_devices/{deviceId}` stays in place for server use; Firestore rules deny client read/write after the rules update.

## Preconditions

1. Deploy the reader that checks `tenant_iot_secrets` first and temporarily falls back to the root field; deploy the server-only Firestore rules.
2. Confirm the intended Firebase project with the service owner and verify the Admin service account has only the access required for this migration.
3. Use a non-production Firestore Emulator/staging fixture first. The migration has not been run by this PR.
4. Do not enable application/debug logging that dumps Firestore document bodies.

## Dry run

Use a specific project and an explicit scope. `--dry-run` is the default:

```sh
node scripts/migrate-tenant-iot-secrets.cjs --project <project-id> --all
node scripts/migrate-tenant-iot-secrets.cjs --project <project-id> --tenant <tenant-id>
```

Review the aggregate counts and conflict statuses. Output may include tenant IDs so an authorized operator can triage conflicts; keep it inside the approved operations channel. The script never prints key values. The expected `wouldMigrate` / `wouldClearLegacy` totals should match the inventory; any `conflicts` requires a stop and manual review.

## Apply — only after explicit operational approval

`--apply` requires both an explicit project/scope and the project-bound confirmation variable. The tool does not infer a default project:

```sh
IOT_SECRET_MIGRATION_CONFIRM=migrate-tenant-iot-secrets:<project-id> \
  node scripts/migrate-tenant-iot-secrets.cjs --project <project-id> --all --apply
```

For a single tenant, replace `--all` with `--tenant <tenant-id>`. The operation is transactional per tenant and idempotent. A conflict exits non-zero after leaving the conflicting root field untouched; never resolve it by overwriting the protected value blindly.

## Read-back / completion gate

After apply, run the same dry-run again. The production evidence must show:

- `wouldMigrate=0`
- `wouldClearLegacy=0`
- `conflicts=0`
- no `tenants/{tenantId}.iotSecret` fields remain in the requested scope
- matching ingest still authenticates through the protected collection
- tenant-member Firestore reads/listing fail for `tenant_iot_secrets` and `iot_devices`

Only then can the legacy read fallback be removed in a separate reviewed change and the Notion ticket reconciled. This PR does not run those production checks or close the ticket.

## Rollback

Before data migration, the new code still reads the legacy root path, so a code rollback preserves existing ingestion but reopens the client-read exposure. After migration, do not roll back to a revision that only reads the tenant root; prefer roll-forward. Copying secrets back into the readable tenant document is a security regression and requires an explicit documented risk decision.
