# Safety test gates

The following tests are release gates for the social publishing backend. They
exercise stateful security and delivery boundaries, not only isolated helpers.

| Gate | Protected failure mode | Test location |
| --- | --- | --- |
| OAuth state replay | A consumed authorization state must not reach provider code exchange a second time. | `oauth.service.spec.ts` |
| Publishing duplicate delivery | A repeated BullMQ delivery must be acknowledged when the DB claim is unavailable and must not call a provider again. | `publish-worker.processor.spec.ts` |
| Retry and terminal failure | Retryable failures schedule only that job; the final attempt is terminal and does not affect sibling platform jobs. | `publish-worker.processor.spec.ts`, `publish-retry.policy.spec.ts` |
| Token encryption/decryption | AES-256-GCM ciphertexts authenticate, retained key versions decrypt old tokens, and the current key version encrypts new tokens. | `token.service.spec.ts` |

Run all gates with `npm.cmd run test`. These are deterministic local tests; a
production release still requires separate Redis/PostgreSQL/provider failure
drills before claiming end-to-end provider coverage.
