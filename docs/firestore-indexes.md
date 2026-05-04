# Firestore Composite Indexes

This document tracks the composite indexes that have to exist for our
production Firestore queries to run. The Firestore SDK throws
`failed-precondition` at runtime if a query needs an index that hasn't
been declared — we collect the `gcloud` invocations here so the indexes
can be applied as part of provisioning a new environment.

You can run these from any machine with `gcloud` installed and access
to the target project (`gcloud config set project <id>` first).

## `nodes` — geo-anchored ZK retrieval (Bucket K)

Source: `src/hooks/useGeoAnchoredNodes.ts`. The hook queries:

```
where('projectId', '==', <project>)
where('metadata.geo.lat', '>=', <latMin>)
where('metadata.geo.lat', '<=', <latMax>)
```

Index command:

```bash
gcloud firestore indexes composite create \
  --collection-group=nodes \
  --query-scope=COLLECTION \
  --field-config=field-path=projectId,order=ascending \
  --field-config=field-path=metadata.geo.lat,order=ascending
```

Notes:

- The longitude axis and the true circular geofence are filtered
  client-side via `utils/haversine.ts` — no index needed for `lng`.
- `metadata.geo.lat` is a nested field; `gcloud` accepts the dotted
  path verbatim.

## `calendar_events` — overdue maintenance reaper (Bucket K.3)

Source: `src/server/jobs/checkOverdueMaintenance.ts`. The job queries:

```
where('startIso', '<=', <nowIso>)
where('status', '==', 'pending')
limit(100)
```

Index command:

```bash
gcloud firestore indexes composite create \
  --collection-group=calendar_events \
  --query-scope=COLLECTION \
  --field-config=field-path=status,order=ascending \
  --field-config=field-path=startIso,order=ascending
```

Notes:

- The MaintenanceStatusPanel UI also queries
  `where('relatedObjectId', '==', X) orderBy('startIso', 'asc')` —
  Firestore creates the single-field equality + range index
  automatically, so no explicit composite is required for that
  combination.
