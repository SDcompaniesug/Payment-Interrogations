# Multi-app payment integration

The payment API supports multiple applications with isolated payment and subscription records.

## Existing application

The existing checkout tester and older clients remain compatible. If `app_id` is omitted, the API uses:

`sd-companies-ug`

## Register another application

Register each app in the Neon database before it can initiate payments. Use a unique lowercase ID:

```sql
INSERT INTO apps (app_id, name, active)
VALUES ('my-new-app', 'My New App', true);
```

To disable an app:

```sql
UPDATE apps SET active = false WHERE app_id = 'my-new-app';
```

## Checkout

POST `/api/checkout`

```json
{
  "app_id": "my-new-app",
  "plan_id": "monthly",
  "msisdn": "2567XXXXXXXX",
  "device_id": "a_stable_installation_id_123",
  "idempotency_key": "unique_request_key_123"
}
```

The API checks that the app is registered and active. Plan prices are read from the server database; never trust an amount sent by the client.

## Check payment status

GET `/api/checkout/status?app_id=my-new-app&device_id=...&reference=...`

## Get subscription

GET `/api/account/subscription?app_id=my-new-app&device_id=...`

## Isolation behavior

- Payments are tagged with `app_id`.
- Subscriptions are tagged with `app_id`.
- Status checks require the same app ID, installation ID, and payment reference.
- Subscription lookups only return subscriptions belonging to that app and installation.
- A successful payment in one app does not activate a subscription in another app.

## Security note

`app_id` is an application namespace, not a secret or proof of identity. Do not embed provider credentials or admin keys in Android apps. The current installation ID is also a client-supplied identifier; production apps should add user authentication and, where available, Android app/device attestation before treating an installation as a strong identity.
