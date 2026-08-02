# Apple App Store Server Library test fixtures

These test-only fixtures are copied from Apple's official
[`app-store-server-library-node`](https://github.com/apple/app-store-server-library-node)
repository, `tests/resources/`, at the `main` branch as retrieved on 2026-08-02.

- `testCA.der`
- `testNotification.jws`
- `transactionInfo.jws`
- `renewalInfo.jws`

Copyright © 2023 Apple Inc. Licensed under the MIT License. They are never loaded
by production code; production trusts only the official Apple PKI roots under
`src/services/billing/certs/`.
