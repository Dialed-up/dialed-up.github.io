# DialedUp

**The online service that never logged off.** DialedUp reimagines a late-'90s online service for 2026: instant messages, chat rooms, mail and profiles, together with modern features such as a social feed, stories and push notifications.

Live at **https://dialedup.lol** · Instant Messages: **https://dialedup.lol/dim.html**

> DialedUp is an independent, fan-made project. It is not affiliated with, endorsed by, or connected to AOL, AIM, Yahoo or Bending Spoons. All trademarks belong to their owners.

## Features

| Area | What's included |
| --- | --- |
| Messaging | Homies List with groups, instant messages with formatting, emoji, reactions, read receipts, voice notes and file sharing, away messages, IM requests from non-homies |
| Community | Chat rooms with moderators, Listening and Watch Parties, interest groups, message boards, live events, polls |
| Social | Homie Feed with posts, likes and comments, 24-hour Homie Updates, profile Walls, Top 8, People You May Know, invite links |
| Engagement | Sign-on streaks and badges, birthday alerts, game leaderboards with a weekly Trivia Night, Trending |
| Mail | Mailbox with folders, attachments and e-greeting cards |
| Portal | Welcome screen, news, weather, sports, horoscopes, radio, podcasts, games and more, reachable through Keywords |
| Apps | Installable as a Home Screen app on iPhone and Android, with push notifications |

## Architecture

- **Front end:** plain HTML, CSS and JavaScript ES modules with no build step, served by GitHub Pages (`index.html`, `dim.html`, `home.html`, `stats.html`, `js/`, `css/`).
- **Data and accounts:** Firebase Realtime Database and Firebase Authentication (Spark plan). All access control lives in [`database.rules.json`](database.rules.json).
- **Push notifications and file transfer:** a Cloudflare Worker ([`worker/`](worker/)) that sends Web Push alerts and stores shared files for 24 hours.
- **Offline support:** a service worker (`sw.js`) using a network-first strategy for the app's own files.
- **News:** a scheduled GitHub Action (`.github/workflows/news.yml`) collects public RSS headlines.

## Security

- **Access rules:** every database path is protected by the Firebase security rules. Private data (IMs, mail, emails, settings) is readable only by its owner, and all writes are validated for ownership, type and size.
- **Content Security Policy:** every page sets a policy that only allows scripts from the site itself and Firebase.
- **Safe rendering:** content from users is escaped or sanitized before it is shown.
- **Worker requests:** each request to the Worker is verified against the sender's Firebase sign-in and rate-limited.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Deploying

1. **Site:** push to `main`; GitHub Pages publishes it automatically. Bump the `?v=` cache-busting numbers in the HTML files when assets change.
2. **Database rules:** copy `database.rules.json` into Firebase console → Realtime Database → Rules → Publish.
3. **Worker:** see [`worker/README.md`](worker/README.md).

## Local development

```sh
python3 -m http.server 8765
# then open http://localhost:8765
```
