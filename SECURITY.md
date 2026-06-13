# Security Policy

## Reporting a vulnerability

Please report security issues privately — **do not open a public GitHub issue.**

Email **security@unisonlabs.ai** with:

- a description of the issue and its impact,
- steps to reproduce (a proof-of-concept if you have one),
- any suggested remediation.

We aim to acknowledge within 3 business days and to keep you updated as we
investigate. We'll credit reporters who want it once a fix ships.

## Scope

This repository is a **client library** (TypeScript SDK for code chunking and brain
ingest). It holds no secrets and is not a security boundary — all authentication,
authorization, workspace isolation, and rate limiting are enforced **server-side** by
the Unison brain API. Reports about this library are most useful when they concern:

- credential handling (how `UNISON_TOKEN` is read and transmitted),
- dependency or supply-chain risks,
- path traversal or injection in chunk path generation.

Server-side or account issues should also go to the same email address.

## Credential handling

The library reads `UNISON_TOKEN` from the environment and sends it as
`Authorization: Bearer <token>` only to the configured API host (`UNISON_API_URL`,
defaulting to `https://brain.unisonlabs.ai`). The token is never logged, written to
disk by this library, or transmitted anywhere else.

Never commit a real `usk_live_...` token to this repository. Use `.env` (which is
`.gitignore`d) and copy `.env.example` as a starting point.
