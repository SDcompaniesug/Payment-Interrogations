# S.D Pay
S.D Pay is the Uganda-only payment platform of S.D Payments LTD, a brand of S.D Companies Ug.

## Sandbox features
Merchant registration/login, PostgreSQL-backed merchant data, hashed test API keys shown once, hosted payment links, simulated checkout, test API payments with idempotency, basic ledger entries and simulated payout records.

## Setup
Connect a Neon PostgreSQL database to the Vercel project and set DATABASE_URL. SESSION_SECRET and API_KEY_PEPPER are already configured in Vercel. Tables are created on first database-backed request. Visit /dashboard to register.

## Test API
POST /api/v1/payments with Authorization: Bearer sd_test_... and Idempotency-Key: unique-value. JSON: {"amount":12000,"currency":"UGX","reference":"ORDER-1001","method":"mtn_momo"}.

All outcomes are internal simulations. No MTN/Airtel/card provider is contacted and no funds move. Real provider sandbox work still needs provider-issued credentials and specifications. Live payments and payouts remain disabled pending compliance and written approvals.