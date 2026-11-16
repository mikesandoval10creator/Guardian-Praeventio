# Pre-shift incident window

For a valid selected `date=D` (`YYYY-MM-DD`), recent incidents are filtered
against **seven complete UTC calendar days preceding D**:

`[D at 00:00 UTC minus seven days, D at 00:00 UTC)`.

The lower bound is inclusive; the upper bound is exclusive. This is the same
UTC date convention already used for the selected task day. It is not a
project-local timezone or an inferred hour for day/evening/night shifts.
When the date is omitted, the existing UTC-today default remains in effect.
An incident at/after D's midnight does not belong to these preceding days.

## Fix and preservation

The route previously used `Date.now() - seven days` and had no upper bound.
Historical requests could receive current incidents instead of their own
history; future requests could include events outside their selected window.
The filter now derives both bounds from the already selected `shiftDayStart`.

The existing project-scoped bounded Firestore read is preserved. This does not
add a mixed-type Firestore index, change permissions, write any data, modify
weights/recommendations, or change the legacy `occurredAt` → `createdAt`
coercion/fallback. The existing 200-document read and 50-result cap remain;
this change does not claim exhaustive historical pagination. The existing
fallback for absent/non-shaped date queries remains. A shaped but impossible
calendar date now returns HTTP 400 with `invalid_shift_date` and a Spanish
message asking the person to select a real date; it is never normalized into a
different day or allowed to produce a NaN-bounded incident assessment. Real leap
days remain accepted. Tests cover both the status/code and the actual shared
client error-message conversion used by the hook/page.
Other panel sources remain their existing current-state reads, so a requested
past/future date does **not** constitute a historical snapshot or a forecast of
weather, workers, permits or equipment.

## Reproduction and verification

```sh
node node_modules/vite-plus/bin/vp test run --maxWorkers=2 src/__tests__/server/preShiftRisk.test.ts src/services/shiftRiskPanel/preShiftRiskComposer.test.ts src/pages/PreShiftRisk.test.tsx src/components/shiftRiskPanel/PreShiftRiskCard.test.tsx
```

The new real-router tests freeze only Date, leaving HTTP scheduling real. They
compare historical, future and explicit-today requests with the same execution
clock and exercise both boundaries to the millisecond. They also cover the
numeric legacy `createdAt` fallback, invalid incident timestamps and foreign
project records. The new cases use the actual composer and verify the returned
incident factor, human-readable recommendation and unchanged score composition.
The initial run failed all three selected-date cases for the expected incident
IDs before the filter was corrected.

The existing router harness uses fake Firestore and test authentication;
membership is the real production helper. This proves the selected route and
composer behavior, **not** real Firebase Auth/Firestore, device delivery,
operational safety certification, deployment or full-app E2E. The page and card
suites are regression coverage, not a browser/emulator end-to-end claim.
Full final-SHA CI (including Typecheck, Build and Stryker core) remains mandatory
before merge.
