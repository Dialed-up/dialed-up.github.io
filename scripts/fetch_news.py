"""Collect headlines from public news RSS feeds into news.json for DialedUp.

Only headlines, links, times, sources and thumbnail URLs are kept, which is what RSS feeds are published for.
"""
import json, re, sys, time, html
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

FEEDS = {
    "top": [
        ("CNN", "http://rss.cnn.com/rss/cnn_topstories.rss"),
        ("NBC News", "https://feeds.nbcnews.com/nbcnews/public/news"),
        ("CBS News", "https://www.cbsnews.com/latest/rss/main"),
        ("ABC News", "https://abcnews.go.com/abcnews/topstories"),
        ("NPR", "https://feeds.npr.org/1001/rss.xml"),
        ("Fox News", "https://moxie.foxnews.com/google-publisher/latest.xml"),
    ],
    "us": [
        ("CNN", "http://rss.cnn.com/rss/cnn_us.rss"),
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/US.xml"),
        ("ABC News", "https://abcnews.go.com/abcnews/usheadlines"),
        ("CBS News", "https://www.cbsnews.com/latest/rss/us"),
    ],
    "world": [
        ("BBC", "https://feeds.bbci.co.uk/news/world/rss.xml"),
        ("CNN", "http://rss.cnn.com/rss/cnn_world.rss"),
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"),
        ("NPR", "https://feeds.npr.org/1004/rss.xml"),
    ],
    "nyc": [
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml"),
        ("Gothamist", "https://gothamist.com/feed"),
    ],
    "business": [
        ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml"),
    ],
    "entertainment": [
        ("Variety", "https://variety.com/feed/"),
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml"),
        ("Billboard", "https://www.billboard.com/feed/"),
    ],
    "tech": [
        ("The Verge", "https://www.theverge.com/rss/index.xml"),
        ("NYT", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml"),
        ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
    ],
    "sports": [
        ("ESPN", "https://www.espn.com/espn/rss/news"),
        ("ESPN NBA", "https://www.espn.com/espn/rss/nba/news"),
        ("ESPN NFL", "https://www.espn.com/espn/rss/nfl/news"),
        ("ESPN MLB", "https://www.espn.com/espn/rss/mlb/news"),
        ("ESPN NHL", "https://www.espn.com/espn/rss/nhl/news"),
    ],
}

MAX_AGE_HOURS = 72          # skip feeds whose newest story is older than this (stale feeds)
NS = {"media": "http://search.yahoo.com/mrss/", "atom": "http://www.w3.org/2005/Atom"}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "DialedUp-News/1.0 (+https://dialed-up.github.io)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", text or ""))).strip()


def when(text):
    if not text:
        return 0
    try:
        return int(parsedate_to_datetime(text).timestamp() * 1000)
    except Exception:
        pass
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return 0


def image_of(item):
    for tag in ("media:content", "media:thumbnail"):
        for el in item.findall(tag, NS):
            url = el.get("url")
            if url and (el.get("medium") in (None, "image") or re.search(r"\.(jpe?g|png|webp)", url, re.I)):
                return url
    enc = item.find("enclosure")
    if enc is not None and (enc.get("type") or "").startswith("image"):
        return enc.get("url")
    desc = item.findtext("description") or ""
    m = re.search(r'<img[^>]+src="([^"]+)"', desc)
    return m.group(1) if m else None


def parse(source, raw):
    root = ET.fromstring(raw)
    items = root.findall(".//item") or root.findall(".//atom:entry", NS)
    out = []
    for it in items[:15]:
        title = clean(it.findtext("title") or it.findtext("atom:title", namespaces=NS))
        link = (it.findtext("link") or "").strip()
        if not link:
            el = it.find("atom:link", NS)
            link = el.get("href") if el is not None else ""
        ts = when(it.findtext("pubDate") or it.findtext("atom:updated", namespaces=NS) or it.findtext("atom:published", namespaces=NS))
        if title and link.startswith("http"):
            out.append({"title": title[:220], "url": link, "source": source, "ts": ts, "image": image_of(it)})
    return out


def main():
    now = time.time() * 1000
    result = {"updated": int(now), "sources": {}}
    for cat, feeds in FEEDS.items():
        stories, seen = [], set()
        for source, url in feeds:
            try:
                items = parse(source, fetch(url))
            except Exception as e:
                result["sources"][f"{cat}/{source}"] = f"error: {type(e).__name__}"
                continue
            newest = max((i["ts"] for i in items), default=0)
            if newest and now - newest > MAX_AGE_HOURS * 3600 * 1000:
                result["sources"][f"{cat}/{source}"] = "stale, skipped"
                continue
            result["sources"][f"{cat}/{source}"] = f"ok ({len(items)})"
            for i in items:
                key = re.sub(r"\W+", "", i["title"].lower())[:60]
                if key not in seen:
                    seen.add(key)
                    stories.append(i)
        stories.sort(key=lambda i: i["ts"], reverse=True)
        result[cat] = stories[:40]
    for k, v in sorted(result["sources"].items()):
        print(f"{k:28} {v}")
    with open(sys.argv[1] if len(sys.argv) > 1 else "news.json", "w") as f:
        json.dump(result, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
