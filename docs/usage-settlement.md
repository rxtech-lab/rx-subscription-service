# Usage settlement

GET /api/v1/usage advertises capabilities: ["settle_usage_v1"].
POST /api/v1/usage accepts operation "settle", rxlabUserId, item, the original consume idempotencyKey, and an explicit nonnegative integer amount (actual usage).
It requires usage.record scope and returns { settled: true, duplicate: boolean }.
Settlement only reduces a successful reservation, adjusts its original period, and is atomic with consume/release. Matching retries are idempotent; conflicting amounts, missing/released reservations and balance-charged usage are rejected. Settled reservations cannot be released.
No migration is required: an adjustment record uses the existing usage_records table.
Deploy this service before Flowcy, which requires this capability. Existing reservations can be settled using their original scoped keys. This does not introduce automatic recovery of interrupted model calls.
