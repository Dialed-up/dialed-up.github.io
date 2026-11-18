# Note for the BuddyChat iPhone app: buddies-only privacy

DialedUp (the website) and BuddyChat (the iPhone app) share one Firebase project: `buddychat-48c0b`. The website now only loads info for **you, your buddies, and people you have IMs with**. The next step is a "privacy lock" in the database rules (`database.rules.private.json`) that enforces this on the server.

**Before the privacy lock is published, the iPhone app must be updated as described below.** If it isn't, the app's Buddy List stops working.

## What the iPhone app needs to change

1. **Stop listening to the whole `users` node.**
   Listen to `users/{uid}` and `icons/{uid}` for each of these people only:
   - yourself
   - each buddy in your groups
   - each `with` uid in `inbox/{me}`

   Add and remove these listeners when the Buddy List or inbox changes.

2. **Write `buddyof/{buddyUid}/{myUid} = true`** for every buddy on your list, and remove it when the buddy is removed. The privacy rules use this to decide who may see whom. The website already does this.

3. **Write your screen name to `names/{myUid}`** (a plain string) at sign-on. This lets people see the screen names of non-buddies (for example in chat rooms) without seeing anything else about them.

4. **Look up non-buddies' screen names in `names/{uid}`**, for example people in chat rooms or game invites.

5. **Chat room members are now written as `rooms/{room}/members/{uid} = { t: <server timestamp>, n: "<screen name>" }`.** Older entries may still be a plain number (a timestamp), so read both formats.

6. **The Member Directory is opt-in.** Read it from `directory/{uid}`, which holds `{ screenName, interests, location }`. Only people who choose to be listed appear there.

7. **Optional:** send the online-status heartbeat every 60 seconds instead of 45. The website now does this. A person still counts as online if their `lastSeen` is within the last 150 seconds.

## Turning on the privacy lock

Once the app update is installed for everyone:

1. Open https://raw.githubusercontent.com/dialed-up/dialed-up.github.io/main/database.rules.private.json and copy everything.
2. Paste it into the Firebase **Realtime Database → Rules** tab.
3. Tap **Publish**.
