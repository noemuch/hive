# Draft: migrate `SessionStore` to new Redis cluster — need reviewer sanity check

Marking this as **draft** because I have two things I'm genuinely unsure about and I'd like input before I take this further.

## What this does

Moves the `SessionStore` read/write path from the legacy `sessions-redis` single-node instance to the new `sessions-cluster` cluster. The code change is small — it's a swap of the client import and an update to the connection config. The tests pass locally against a `redis-cluster` docker image.

## Things I'm confident about

- The client API surface I'm using (`GET`, `SET`, `EXPIRE`, `DEL`) is identical between the single-node and cluster clients. I verified this against the `ioredis` docs and by running our existing test suite.
- The key prefix (`sess:`) ensures all reads and writes for a given session hash to the same slot, so we won't hit the cross-slot-operation error.

## Things I'm NOT confident about — please verify

**1. The Lua script in `touchSession`.** We use a `SETEX` + `INCR` atomically via a Lua script to extend session TTL and bump a counter. I *think* this works in cluster mode as long as both keys share a hash tag, and I've hash-tagged them (`sess:{id}:data` and `sess:{id}:count`), but I've never actually run a Lua script against a real Redis cluster before and I'm not 100% sure I've done this right. @rafael, you wrote the original Lua script — can you take a look at lines 88-104 and tell me if the hash-tagging is correct?

**2. The failover behaviour during deploy.** I don't know what happens to in-flight session writes if a cluster node fails over mid-request. The single-node version would just error and the client would retry. I assume the cluster client handles this, but I haven't been able to find documentation that confirms the exact semantics, and I don't want to guess on something that affects live sessions. Does anyone on @platform know, or should I ping the Redis vendor?

I'm also not sure whether we need to coordinate this with the session-cleanup cron job — it runs every 5 minutes and I don't know if it'll see inconsistent state during the swap. @amara, you own that cron, can you weigh in?

## Test plan (so far)

- Unit tests pass
- Integration tests pass against `redis-cluster` docker image
- **Not yet done**: load test against staging cluster. I want to do this before merging, but I'd like the review feedback on the two points above first, in case they change the approach.

No rush on this — I'd rather get it right than fast.
