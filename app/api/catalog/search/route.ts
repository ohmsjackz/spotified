import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 0;

type ArchiveDoc = { identifier?: string; title?: string; creator?: string | string[]; licenseurl?: string; year?: string; downloads?: number };
type ArchiveFile = { name?: string; format?: string; source?: string; size?: string; private?: string };

function allowedLicense(value: string) {
  const license = value.toLowerCase();
  return license.includes("creativecommons.org/publicdomain/mark/1.0") ||
    license.includes("creativecommons.org/publicdomain/zero/1.0") ||
    license.includes("creativecommons.org/licenses/by/4.0") ||
    license.includes("creativecommons.org/licenses/by-sa/4.0");
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return typeof value === "string" ? value : "";
}
function artworkUrl(value: any): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  return value["480x480"] || value["1000x1000"] || value["150x150"] || value["original"] || Object.values(value).find(x => typeof x === "string") as string | undefined;
}

async function searchAudius(query: string) {
  const params = new URLSearchParams({ query, limit: "50", sort_method: "popular" });
  const response = await fetch("https://api.audius.co/v1/tracks/search?" + params.toString(), {
    headers: { "User-Agent": "Spotified/1.0 (music discovery)" },
    signal: AbortSignal.timeout(10000),
    next: { revalidate: 120 }
  });
  if (!response.ok) throw new Error("Audius search unavailable");
  const payload = await response.json();
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.filter((track: any) => track?.id && track.is_streamable !== false && !track.is_stream_gated && !track.is_scheduled_release && Number(track.duration || 0) >= 60)
    .map((track: any) => ({
      id: "audius-" + track.id,
      title: text(track.title) || "Untitled track",
      artist: text(track.user?.name) || text(track.artist_name) || "Unknown artist",
      url: "https://api.audius.co/v1/tracks/" + encodeURIComponent(track.id) + "/stream?app_name=Spotified",
      artwork: artworkUrl(track.artwork),
      source: "catalog",
      provider: "Audius",
      popularity: Number(track.play_count ?? track.playCount ?? 0),
      externalUrl: track.permalink || ("https://audius.co/" + (track.user?.handle || "") + "/" + (track.slug || track.id))
    }));
}

async function searchArchive(raw: string) {
  const safeTerms = raw.toLowerCase().match(/[a-z0-9]{2,}/g)?.slice(0,8) ?? [];
  if (!safeTerms.length) return [];
  const termClauses = safeTerms.flatMap(term => [`title:${term}`, `creator:${term}`, `subject:${term}`]);
  const licenseClause = ["licenseurl:*publicdomain*", "licenseurl:*creativecommons.org/licenses/by/4.0*", "licenseurl:*creativecommons.org/licenses/by-sa/4.0*"].join(" OR ");
  const query = `mediatype:audio AND (${licenseClause}) AND (${termClauses.join(" OR ")})`;
  const params = new URLSearchParams({ q: query, output: "json", rows: "100", page: "1" });
  for (const field of ["identifier", "title", "creator", "licenseurl", "year", "downloads"]) params.append("fl[]", field);
  params.append("sort[]", "downloads desc");
  const searchResponse = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), {
    headers: { "User-Agent": "Spotified/1.0 (music search)" },
    signal: AbortSignal.timeout(12000),
    next: { revalidate: 300 }
  });
  if (!searchResponse.ok) throw new Error("Internet Archive search unavailable");
  const searchData = await searchResponse.json();
  const docs: ArchiveDoc[] = (searchData.response?.docs ?? []).filter((doc: ArchiveDoc) => doc.identifier && doc.licenseurl && allowedLicense(doc.licenseurl));
  const candidates = await Promise.all(docs.slice(0, 30).map(async (doc) => {
    try {
      const response = await fetch("https://archive.org/metadata/" + encodeURIComponent(doc.identifier!), {
        headers: { "User-Agent": "Spotified/1.0 (music search)" },
        signal: AbortSignal.timeout(10000),
        next: { revalidate: 3600 }
      });
      if (!response.ok) return null;
      const metadata = await response.json();
      const itemLicense = text(metadata.metadata?.licenseurl) || text(doc.licenseurl);
      if (!allowedLicense(itemLicense)) return null;
      const files: ArchiveFile[] = metadata.files ?? [];
      const audioFiles = files.filter(file => file.name && file.private !== "true" && file.source !== "metadata" && /\.(mp3|m4a|wav|flac|ogg|opus)$/i.test(file.name));
      audioFiles.sort((a, b) => {
        const score = (file: ArchiveFile) => {
          const name = (file.name ?? "").toLowerCase(), format = (file.format ?? "").toLowerCase();
          return (name.endsWith(".mp3") ? 10 : 0) + (name.endsWith(".m4a") || name.endsWith(".mp4") ? 8 : 0) + (name.endsWith(".wav") ? 5 : 0) + (format.includes("vbr mp3") ? 2 : 0) + (file.source === "derivative" ? 1 : 0) + (Number(file.size || 0) > 100000 ? 1 : 0);
        };
        return score(b) - score(a);
      });
      const file = audioFiles[0];
      if (!file?.name) return null;
      const identifier = doc.identifier!;
      const encodedFile = file.name.split("/").map(encodeURIComponent).join("/");
      return {
        id: "ia-" + identifier + "-" + file.name,
        title: text(metadata.metadata?.title) || text(doc.title) || identifier,
        artist: text(metadata.metadata?.creator) || text(doc.creator) || "Unknown artist",
        url: "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodedFile,
        artwork: "https://archive.org/services/img/" + encodeURIComponent(identifier),
        license: itemLicense,
        archiveUrl: "https://archive.org/details/" + encodeURIComponent(identifier),
        source: "catalog",
        provider: "Internet Archive"
      };
    } catch { return null; }
  }));
  return candidates.filter(Boolean);
}

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (raw.length < 2) return NextResponse.json({ results: [] });
  if (raw.length > 100) return NextResponse.json({ error: "Search is limited to 100 characters." }, { status: 400 });
  try {
    const requestedVariant = /\b(remix|cover|karaoke|nightcore|slowed|speed.?up|instrumental|mashup|bootleg|tribute)\b/i.test(raw);
    const [audius, archive] = await Promise.allSettled([searchAudius(raw), searchArchive(raw)]);
    const audiusResults = audius.status === "fulfilled" ? audius.value : [];
    const archiveResults = archive.status === "fulfilled" ? archive.value : [];
    const normalized = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    const ranked = [...audiusResults, ...archiveResults].filter((track: any) => {
      if (requestedVariant) return true;
      return !/\b(remix|cover|karaoke|nightcore|slowed|speed.?up|instrumental|mashup|bootleg|tribute|rework|edit)\b/i.test(String(track.title || ""));
    }).map((track: any) => {
      const title = String(track.title || "").toLowerCase();
      const artist = String(track.artist || "").toLowerCase();
      const titleHits = words.filter(word => title.includes(word)).length;
      const artistHits = words.filter(word => artist.includes(word)).length;
      const allTermsMatch = words.every(word => title.includes(word) || artist.includes(word));
      const relevance = (allTermsMatch ? 20 : 0) + titleHits * 3 + artistHits * 5 + (title === normalized ? 8 : 0);
      const popularity = Math.log10(1 + Math.max(0, Number(track.popularity || 0))) * 10;
      const exactArtistBoost = words.some(word => word.length > 2 && artist.includes(word)) ? 12 : 0;
      const fullTrackBonus = track.provider === "Audius" || track.provider === "Internet Archive" ? 3 : 0;
      return { track, score: relevance + popularity + exactArtistBoost + fullTrackBonus };
    }).sort((a, b) => b.score - a.score);
    const results = ranked.slice(0, 50).map(item => item.track);
    if (!results.length && audius.status === "rejected" && archive.status === "rejected") {
      return NextResponse.json({ error: "Music search sources are temporarily unavailable. Please try again." }, { status: 502 });
    }
    return NextResponse.json({
      results,
      sources: { audius: audiusResults.length, internetArchive: archiveResults.length }
    }, { headers: { "Cache-Control": "public, s-maxage=180, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "Music search failed. Please try again." }, { status: 502 });
  }
}
