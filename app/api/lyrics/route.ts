import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const title = (request.nextUrl.searchParams.get("track") || "").trim();
  const artist = (request.nextUrl.searchParams.get("artist") || "").trim();
  const duration = Number(request.nextUrl.searchParams.get("duration") || 0);
  if (!title || !artist) return NextResponse.json({ error: "Track title and artist are required." }, { status: 400 });

  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const response = await fetch("https://lrclib.net/api/search?" + params.toString(), {
      headers: { "User-Agent": "Spotified/1.0 (https://github.com/ohmsjackz/spotified)" },
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 3600 }
    });
    if (response.status === 429) return NextResponse.json({ error: "Lyrics service is busy. Please try again in a moment." }, { status: 429 });
    if (!response.ok) throw new Error("Lyrics provider unavailable");
    const rows = await response.json();
    const normalizedTitle = title.toLowerCase();
    const normalizedArtist = artist.toLowerCase();
    const ranked = (Array.isArray(rows) ? rows : []).map((row: any) => {
      const titleMatch = String(row.trackName || "").toLowerCase() === normalizedTitle;
      const artistMatch = String(row.artistName || "").toLowerCase().includes(normalizedArtist) || normalizedArtist.includes(String(row.artistName || "").toLowerCase());
      const durationMatch = duration > 0 && Number(row.duration) > 0 ? Math.abs(Number(row.duration) - duration) <= 5 : false;
      return { row, score: (titleMatch ? 4 : 0) + (artistMatch ? 4 : 0) + (durationMatch ? 2 : 0) };
    }).sort((a: any, b: any) => b.score - a.score);
    const match = ranked[0]?.row;
    if (!match || ranked[0].score < 6 || (!match.plainLyrics && !match.syncedLyrics)) {
      return NextResponse.json({ lyrics: null, message: "Lyrics aren't available for this track yet." });
    }
    return NextResponse.json({
      lyrics: {
        trackName: match.trackName,
        artistName: match.artistName,
        plainLyrics: match.plainLyrics || null,
        syncedLyrics: match.syncedLyrics || null
      }
    }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load lyrics right now." }, { status: 502 });
  }
}
