# Shashura SD Pay

Backend and checkout tester for Shashura mobile-money collections.

This repository is the source of truth for the rebuilt Vercel API. Secrets are configured only in Vercel environment variables and must never be committed.

## Deployment

Vercel project: `shashura-sd-pay`

Production API: `https://shashura-sd-pay.vercel.app`

## Safety

- Payment collection is initiated only by the backend.
- Prices are read from Neon Postgres.
- Subscriptions are activated only after server-side provider status verification.
- Device IDs are temporary installation identifiers, not proof of account identity.
- Never commit `.env` files or provider credentials.
