# DialedUp Worker

A Cloudflare Worker that provides two services:

- **Push notifications:** Web Push alerts for new instant messages and mail, delivered even when DialedUp is closed.
- **File transfer:** temporary storage for files shared in IMs and Homie Updates. Files are limited to 25 MB and deleted after 24 hours.

## How requests are verified

Every request carries the sender's Firebase ID token. The Worker reads the relevant record from the Realtime Database using that token, so the database's own security rules decide whether the request is allowed. Alerts are only sent for messages that actually exist and were sent by the caller. Each account is also rate-limited.

## Configuration

| Setting | Where |
| --- | --- |
| `VAPID_PUBLIC` | `wrangler.toml` (public; also used in `js/notify.js`) |
| `VAPID_PRIVATE` | Cloudflare secret: `npx wrangler secret put VAPID_PRIVATE` (never committed) |
| `MAIL_KEY` | Cloudflare secret: encryption key for members' private emails (sign on by screen name, password reset) |
| `SUBS` | Workers KV namespace for push subscriptions, rate-limit counters and temporary files |

## Deploy

```sh
npm i @block65/webcrypto-web-push wrangler
npx wrangler deploy
```
