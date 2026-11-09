from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import json
import traceback

from ytmusicapi import YTMusic


class handler(BaseHTTPRequestHandler):
    def _json(self, payload, status=200):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        try:
            params = parse_qs(urlparse(self.path).query)
            query = (params.get("q") or [""])[0].strip()
            if len(query) < 2:
                return self._json({"results": []})
            if len(query) > 100:
                return self._json({"error": "Search is limited to 100 characters."}, 400)

            # Search implementation adapted from harshitethic/OpenTune (MIT).
            # Audio is played only through YouTube's official embedded player.
            rows = YTMusic().search(query, filter="songs", limit=25)
            results = []
            for item in rows:
                video_id = item.get("videoId")
                title = str(item.get("title") or "").strip()
                artists = item.get("artists") or []
                artist = ", ".join(
                    str(person.get("name") or "").strip()
                    for person in artists
                    if isinstance(person, dict) and person.get("name")
                )
                thumbnails = item.get("thumbnails") or []
                artwork = thumbnails[-1].get("url") if thumbnails and isinstance(thumbnails[-1], dict) else None
                if not video_id or not title or not artist:
                    continue
                results.append({
                    "id": "ytmusic-" + video_id,
                    "videoId": video_id,
                    "title": title,
                    "artist": artist,
                    "durationText": item.get("duration") or "",
                    "artwork": artwork,
                    "url": "https://www.youtube.com/watch?v=" + video_id,
                    "externalUrl": "https://music.youtube.com/watch?v=" + video_id,
                    "provider": "YouTube Music",
                    "source": "catalog",
                    "playback": "youtube-embed",
                    "downloadable": False
                })
            return self._json({"results": results, "provider": "OpenTune / ytmusicapi"})
        except Exception:
            traceback.print_exc()
            return self._json({"error": "YouTube Music search is temporarily unavailable. Please try again."}, 502)

    def do_POST(self):
        return self._json({"error": "Method not allowed."}, 405)
