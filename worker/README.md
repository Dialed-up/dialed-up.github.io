# DialedUp push sender (Cloudflare Worker)

Sends push alerts for new IMs and mail, even when DialedUp is closed.
Lives at https://dialedup-push.stickyarcadecloud.workers.dev on the free Cloudflare plan.

- `VAPID_PUBLIC` is public (also in `js/notify.js`).
- `VAPID_PRIVATE` is a Cloudflare secret — it is **not** in this repo.
- Phone subscriptions are stored in the Workers KV namespace bound as `SUBS`.

Deploy: `npm i @block65/webcrypto-web-push wrangler && npx wrangler deploy`
