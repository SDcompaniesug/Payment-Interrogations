# S.D Pay

S.D Pay is the Uganda-only payment platform brand of **S.D Payments LTD**, a company under **S.D Companies Ug**.

## Current state
Initial Next.js 15 + TypeScript website and API foundation. The public site is a preview shell. Payment execution is deliberately disabled: no payment is attempted until provider onboarding, regulatory review, credentials, database migrations, merchant authentication, signed callbacks and reconciliation have been implemented and verified.

## Local development
- Node.js 20+
- `npm install`
- Copy `.env.example` to `.env.local`
- `npm run dev`

## API
- `GET /api/v1/health` — service metadata and readiness flags.
- `POST /api/v1/payments` — validates request shape and bearer header, then returns a safe 503 until a provider adapter and approvals exist.

Amounts are integer UGX shillings. Never treat a browser redirect as proof of payment.

## Launch gates
1. Provision PostgreSQL and apply migrations.
2. Implement merchant registration, MFA, sessions and tenant isolation.
3. Implement hashed test/live API keys, idempotency storage and audit logs.
4. Complete MTN MoMo and Airtel Money provider onboarding and sandbox verification.
5. Add card acquiring through an approved PCI-compliant hosted checkout provider. Do not store PAN/CVV.
6. Add provider signature verification, replay protection, webhook retries and reconciliation.
7. Implement immutable double-entry ledger, balances, refunds and payout reservations.
8. Obtain legal advice and confirm the applicable Bank of Uganda regulatory model and written provider approvals before enabling live funds movement.

Secrets belong in Vercel Environment Variables, never in Git or chat. `SDPAY_PAYMENTS_ENABLED` must remain false until all launch gates are met.