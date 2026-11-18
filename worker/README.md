# DialedUp push sender (Cloudflare Worker)

Sends push alerts for new IMs and mail, even when DialedUp is closed.
Runs on DialedUp's own free Cloudflare account. Its address goes in `PUSH` in `js/notify.js`.

- `VAPID_PUBLIC` is public (also in `js/notify.js`).
- `VAPID_PRIVATE` is a Cloudflare secret — it is **not** in this repo.
- Phone subscriptions are stored in the Workers KV namespace bound as `SUBS`.

Deploy: `npm i @block65/webcrypto-web-push wrangler && npx wrangler deploy`
