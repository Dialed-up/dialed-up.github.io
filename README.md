# DialedUp

**The online service that never logged off.** It's a 1999-style online service, reimagined for 2026.

Live at **https://dialed-up.github.io**

## Features

- **Sign on:** a dial-up connecting show with sounds synthesized in the browser.
- **Desktop:** windows you can drag, resize and minimize, plus a taskbar.
- **Welcome portal:**
  - Weather from Open-Meteo
  - News from Wikipedia
  - Horoscopes
  - Hot Spots
- **Channels:**
  - News
  - Weather
  - Sports scores from ESPN
  - Tech links from Hacker News
  - Horoscopes
  - Games (Byte Snake)
  - NYC
  - People
- **Keyword box:** jump anywhere by typing a word.
- **Buddy List, IMs, chat rooms, away messages, profiles and file transfers.** These are shared with the **BuddyChat** iPhone app, so the same screen names work in both.
- **Build Your Home Page:** glitter titles, scrolling text, backgrounds, chiptune songs, a visitor counter and a guestbook. Pages are public at `home.html?u=screenname`.

## Tech

- Plain HTML, CSS and JavaScript, with no build step. Hosted free on GitHub Pages.
- Accounts and data use Firebase (free Spark plan), the same project as BuddyChat.
- The database security rules are in `database.rules.json`. Paste them into Firebase → Realtime Database → Rules.
