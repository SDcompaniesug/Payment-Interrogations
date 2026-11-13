# Multi-app payment integration

The central payment API supports independent applications. Each app has its own plans, prices, descriptions, features, transactions, and subscriptions.

## Existing application

Older clients may omit `app_id`; the API defaults to `sd-companies-ug`. New integrations should always send an explicit app ID.

## Register another application

```sql
INSERT INTO apps (app_id, name, active, currency, country, settings)
VALUES (
  'cineverse',
  'Cineverse',
  true,
  'UGX',
  'UG',
  '{"support_email":"support@example.com"}'::jsonb
);
```

App IDs must be unique lowercase identifiers. Settings are app-specific JSON configuration.

## Create plans for that app

Plan IDs are globally unique in the current database, so prefix them with the app ID:

```sql
INSERT INTO subscription_plans
  (id, app_id, name, description, amount, duration_days, currency, features, active)
VALUES
  ('cineverse_monthly', 'cineverse', 'Monthly', '30 days of Cineverse Premium', 5000, 30, 'UGX',
   '["HD streaming","No ads","Premium channels"]'::jsonb, true),
  ('cineverse_yearly', 'cineverse', 'Yearly', '365 days of Cineverse Premium', 50000, 365, 'UGX',
   '["HD streaming","No ads","Premium channels","Priority support"]'::jsonb, true);
```

Existing S.D Companies Ug plans remain assigned to `sd-companies-ug`. An app cannot purchase another app's plan because checkout looks up the plan using both `app_id` and `plan_id`.

To change a plan, update its row. To hide a plan, set `active=false`. Do not reuse a plan ID belonging to another app.

## Read app configuration and plans

- `GET /api/app/config?app_id=cineverse`
- `GET /api/plans?app_id=cineverse`

The plans response includes the app's currency and settings plus each plan's name, description, amount, duration, currency, and feature list.

## Checkout

POST `/api/checkout`

```json
{
  "app_id": "cineverse",
  "plan_id": "cineverse_monthly",
  "msisdn": "2567XXXXXXXX",
  "device_id": "a_stable_installation_id_123",
  "idempotency_key": "unique_request_key_123"
}
```

The server reads the price, duration, and currency from the app's plan row. It does not trust a client-supplied amount.

## Check payment status and subscription

- `GET /api/checkout/status?app_id=cineverse&device_id=...&reference=...`
- `GET /api/account/subscription?app_id=cineverse&device_id=...`

Status checks require the same app ID, installation ID, and payment reference. Subscription lookups are scoped to that app and installation.

## Isolation

- Each app has its own active/inactive state and configuration.
- Each app has its own plans, prices, durations, descriptions, and features.
- Payments and subscriptions are tagged with the originating app ID.
- A payment in one app cannot activate a subscription in another app.

## Current gateway limitation

The configured Shashura integration is Uganda-focused. App-level plan currencies are stored independently, but the current payment gateway setup is configured for UGX/UG. Do not advertise another currency until the gateway and settlement configuration support it.

## Security note

`app_id` is a namespace, not a secret or proof of identity. Do not embed provider credentials or admin keys in Android apps. The current installation ID is also client-supplied; production apps should add authenticated user identities and, where available, Android app/device attestation before treating an installation as a strong identity.
