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


async function searchOpenverse(query: string) {
  const params = new URLSearchParams({
    q: query,
    category: "music",
    page_size: "30",
    license: "cc0,pdm,by,by-sa,by-nc,by-nc-sa,by-nd,by-nc-nd",
    filter_dead: "true"
  });
  const response = await fetch("https://api.openverse.org/v1/audio/?" + params.toString(), {
    headers: { "User-Agent": "Spotified/1.0 (open music discovery)" },
    signal: AbortSignal.timeout(12000),
    next: { revalidate: 300 }
  });
  if (!response.ok) throw new Error("Openverse search unavailable");
  const payload = await response.json();
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return rows.filter((item: any) => item?.id && item.url && item.title && item.creator && item.category === "music")
    .map((item: any) => ({
      id: "openverse-" + item.id,
      title: String(item.title).trim(),
      artist: String(item.creator).trim(),
      url: item.url,
      artwork: item.thumbnail || undefined,
      duration: Number(item.duration || 0) > 0 ? Math.round(Number(item.duration) / 1000) : undefined,
      license: item.license_url || item.license || "Open licence; verify terms",
      licenseCode: item.license || undefined,
      attribution: item.attribution || undefined,
      externalUrl: item.foreign_landing_url || item.detail_url,
      source: "catalog",
      provider: "Openverse",
      downloadable: true
    }));
}

async function searchJamendo(query: string, language?: string) {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) return [];
  const params = new URLSearchParams({
    client_id: clientId, format: "json", limit: "50", search: query,
    audioformat: "mp32", include: "musicinfo", type: "single albumtrack", order: "relevance",
    ...(language ? { lang: language } : {})
  });
  const response = await fetch("https://api.jamendo.com/v3.0/tracks/?" + params.toString(), {
    signal: AbortSignal.timeout(12000), next: { revalidate: 300 }
  });
  if (!response.ok) throw new Error("Jamendo search unavailable");
  const payload = await response.json();
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return rows.filter((track: any) => track?.id && track.audio && track.name && track.artist_name && Number(track.duration || 0) >= 45)
    .map((track: any) => ({
      id: "jamendo-" + track.id, title: String(track.name).trim(), artist: String(track.artist_name).trim(),
      url: track.audio, artwork: track.album_image || track.image || undefined,
      duration: Number(track.duration) || undefined, license: track.license_ccurl || undefined,
      externalUrl: track.shareurl || ("https://www.jamendo.com/track/" + track.id),
      downloadUrl: track.audiodownload_allowed === true ? track.audiodownload : undefined,
      downloadable: track.audiodownload_allowed === true && Boolean(track.audiodownload),
      source: "catalog", provider: "Jamendo", popularity: Number(track.popularity_total || 0)
    }));
}

async function searchFreeToUse(query: string) {
  const params = new URLSearchParams({ query, limit: "50", order: "plays", sort: "desc" });
  const request = async (url: string) => {
    const response = await fetch(url, {
      headers: { "User-Agent": "Spotified/1.0 (personal music player)", "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 180 }
    });
    if (!response.ok) throw new Error("Free To Use search unavailable (" + response.status + ")");
    return response.json();
  };
  let payload = await request("https://api.freetouse.com/v3/music/tracks/search?" + params.toString());
  let rows = Array.isArray(payload?.data) ? payload.data : [];
  // Some API responses may omit searchable rows for a query; browse the public
  // catalogue and match locally rather than returning an empty screen.
  if (!rows.length) {
    const browse = new URLSearchParams({ limit: "100", order: "plays", sort: "desc" });
    payload = await request("https://api.freetouse.com/v3/music/tracks/all?" + browse.toString());
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    rows = (Array.isArray(payload?.data) ? payload.data : []).filter((track: any) => {
      const artistNames = Array.isArray(track?.artists)
        ? track.artists.map((entry: any) => Array.isArray(entry) ? entry?.[1]?.name : entry?.name).filter(Boolean).join(" ")
        : "";
      const haystack = [track?.title, artistNames, track?.genre,
        ...(Array.isArray(track?.tags) ? track.tags.map((entry: any) => Array.isArray(entry) ? entry[1] : entry) : [])]
        .filter(Boolean).join(" ").toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }
  return rows.filter((track: any) =>
    track?.id && track.is_premium !== true && track.title &&
    (track.files?.mp3 || track.audio_url || track.audio)
  ).map((track: any) => {
    const artists = Array.isArray(track.artists)
      ? track.artists.map((entry: any) => Array.isArray(entry) ? entry?.[1]?.name : entry?.name).filter(Boolean)
      : [];
    const artist = artists.join(", ") || text(track.artist_name) || text(track.artist);
    const audioUrl = track.files?.mp3 || track.audio_url || track.audio;
    return {
      id: "freetouse-" + track.id,
      title: String(track.title).trim(),
      artist: artist || "Unknown artist",
      url: audioUrl,
      artwork: track.thumbnails?.md || track.thumbnails?.lg || track.thumbnails?.xl || undefined,
      duration: Number(track.duration) || undefined,
      license: "Free To Use License",
      externalUrl: "https://freetouse.com",
      downloadUrl: audioUrl,
      downloadable: true,
      source: "catalog",
      provider: "Free To Use",
      popularity: Number(track.plays || track.views || 0)
    };
  }).filter((track: any) => track.artist !== "Unknown artist");
}

async function searchAudius(query: string) {
  const params = new URLSearchParams({ query, limit: "50", sort_method: "relevant" });
  const response = await fetch("https://discoveryprovider.audius.co/v1/tracks/search?" + params.toString(), {
    headers: { "User-Agent": "Spotified/1.0 (music discovery)" },
    signal: AbortSignal.timeout(10000),
    next: { revalidate: 120 }
  });
  if (!response.ok) throw new Error("Audius search unavailable");
  const payload = await response.json();
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.filter((track: any) => track?.id && track.is_streamable !== false && !track.is_stream_gated && !track.is_scheduled_release && Number(track.duration || 0) >= 45)
    .map((track: any) => ({
      id: "audius-" + track.id,
      title: text(track.title) || "Untitled track",
      // Never silently relabel an uploader as the credited performer.
      artist: (Array.isArray(track.artists) && track.artists.length
        ? track.artists.map((artist: any) => text(artist?.name)).filter(Boolean).join(", ")
        : text(track.artist_name) || text(track.user?.name)) || "Unknown artist",
      artistCreditVerified: Boolean((Array.isArray(track.artists) && track.artists.some((artist: any) => text(artist?.name))) || text(track.artist_name)),
      isrc: text(track.isrc) || undefined,
      remixOf: track.remix_of || null,
      tags: text(track.tags),
      url: "https://discoveryprovider.audius.co/v1/tracks/" + encodeURIComponent(track.id) + "/stream?app_name=Spotified",
      artwork: artworkUrl(track.artwork),
      source: "catalog",
      provider: "Audius",
      popularity: Number(track.play_count ?? track.playCount ?? 0),
      externalUrl: track.permalink || ("https://audius.co/" + (track.user?.handle || "") + "/" + (track.slug || track.id))
    }));
}

async function searchArchive(raw: string) {
  const safeTerms = raw.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.slice(0,8) ?? [];
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
    const isThaiQuery = /[\u0E00-\u0E7F]/.test(raw) || /\bthai(land)?\b/i.test(raw);
    const searchTerms = [...new Set([
      raw,
      raw.replace(/[“”‘’]/g, "").replace(/[()\[\]{}]/g, " ").replace(/\s+/g, " ").trim(),
      raw.split(/\s+/).filter(Boolean).join(" "),
      ...(isThaiQuery ? ["เพลงไทย", "thai music", "thai"] : [])
    ])].filter(Boolean).slice(0, isThaiQuery ? 5 : 3);
    const [openverseBatch, audiusBatch, jamendoBatch, freeToUseBatch, archive] = await Promise.all([
      Promise.allSettled(searchTerms.map(term => searchOpenverse(term))),
      Promise.allSettled(searchTerms.map(term => searchAudius(term))),
      Promise.allSettled(searchTerms.map(term => searchJamendo(term, isThaiQuery ? "th" : undefined))),
      Promise.allSettled(searchTerms.map(term => searchFreeToUse(term))),
      searchArchive(raw).then(value => ({ status: "fulfilled" as const, value })).catch(error => ({ status: "rejected" as const, reason: error }))
    ]);
    const openverseResults = [...new Map(openverseBatch.flatMap(result => result.status === "fulfilled" ? result.value : []).map((track: any) => [track.id, track])).values()];
    const audiusResults = [...new Map(audiusBatch.flatMap(result => result.status === "fulfilled" ? result.value : []).map((track: any) => [track.id, track])).values()];
    const jamendoResults = [...new Map(jamendoBatch.flatMap(result => result.status === "fulfilled" ? result.value : []).map((track: any) => [track.id, track])).values()];
    const freeToUseResults = [...new Map(freeToUseBatch.flatMap(result => result.status === "fulfilled" ? result.value : []).map((track: any) => [track.id, track])).values()];
    const openverseFailed = openverseBatch.every(result => result.status === "rejected");
    const audiusFailed = audiusBatch.every(result => result.status === "rejected");
    const archiveResults = archive.status === "fulfilled" ? archive.value : [];
    const normalized = raw.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").trim();
    const words = normalized.split(/\s+/).filter(Boolean);

    // A small, explicit canonical catalogue prevents unrelated same-title uploads
    // from being presented as the requested recording. Extend only with verified
    // artist/title pairs; never infer an artist from popularity alone.
    const canonicalOverrides: Record<string, { title: string; artist: string; titleAliases: string[] }> = {
      "golden hour": { title: "golden hour", artist: "JVKE", titleAliases: ["golden hour", "golden hour (official music video)"] }
    };
    const canonical = canonicalOverrides[normalized];
    const candidates = [...openverseResults, ...audiusResults, ...jamendoResults, ...freeToUseResults, ...archiveResults].filter((track: any) => {
      if (isThaiQuery) {
        const metadata = [track.title, track.artist, track.tags, track.description, track.genre, track.provider]
          .filter(Boolean).join(" ").toLowerCase();
        const hasThaiMetadata = /[\\u0E00-\\u0E7F]|\\bthai(land)?\\b/i.test(metadata);
        const exactThaiTextMatch = metadata.includes(normalized);
        if (!hasThaiMetadata && !exactThaiTextMatch) return false;
      }
      if (requestedVariant) return true;
      const title = String(track.title || "").trim();
      const artist = String(track.artist || "").trim();
      const searchableMetadata = title + " " + String(track.tags || "");
      const variantOrSlop = /\b(remix|cover|karaoke|nightcore|slowed|speed.?up|sped.?up|instrumental|mashup|bootleg|tribute|rework|edit|epic version|8d audio|bass boosted|reverb|chipmunk|pitch.?shift|acapella|demo version|fan.?made|type beat|reaction|lyrics video|official music video|visualizer|music video|full album|compilation)\b/i;
      if (!title || !artist || artist.toLowerCase() === "unknown artist") return false;
      if (track.provider === "Audius" && track.remixOf) return false;
      if (track.provider === "Audius" && !track.artistCreditVerified) return false;
      if (variantOrSlop.test(searchableMetadata)) return false;
      if (/^(untitled|unknown|track ?\\d+)$/i.test(title)) return false;
      if (title.length < 2 || artist.length < 2 || title.length > 180 || artist.length > 120) return false;
      return true;
    });
    const verifiedCandidates = canonical
      ? candidates.filter((track: any) => {
          const title = String(track.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
          const artist = String(track.artist || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
          const titleMatch = canonical.titleAliases.some(alias => {
            const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
            return title === normalizedAlias || title.startsWith(normalizedAlias + " ") ||
              (title.includes(normalizedAlias) && title.includes(canonical.artist.toLowerCase()));
          });
          // For this explicitly user-confirmed recording, the uploader may differ
          // from the credited performer. Display the credited artist, not the uploader.
          return titleMatch && (artist === canonical.artist.toLowerCase() || title.includes(canonical.artist.toLowerCase()));
        }).map((track: any) => ({ ...track, title: canonical.title, artist: canonical.artist }))
      : candidates;
    const ranked = verifiedCandidates.map((track: any) => {
      const title = String(track.title || "").toLowerCase();
      const artist = String(track.artist || "").toLowerCase();
      const titleHits = words.filter(word => title.includes(word)).length;
      const artistHits = words.filter(word => artist.includes(word)).length;
      const allTermsMatch = words.every(word => title.includes(word) || artist.includes(word));
      const exactTitle = title === normalized ? 35 : 0;
      const startsWithTitle = title.startsWith(normalized) ? 15 : 0;
      const relevance = (allTermsMatch ? 20 : 0) + titleHits * 5 + artistHits * 3 + exactTitle + startsWithTitle;
      const popularity = Math.log10(1 + Math.max(0, Number(track.popularity || 0))) * 10;
      const openLicenceBoost = track.provider === "Openverse" ? 10 : 0;
      const exactArtistBoost = words.some(word => word.length > 2 && artist.includes(word)) ? 12 : 0;
      const fullTrackBonus = track.provider === "Audius" || track.provider === "Internet Archive" || track.provider === "Jamendo" || track.provider === "Free To Use" ? 3 : 0;
      return { track, score: relevance + popularity + exactArtistBoost + fullTrackBonus + openLicenceBoost };
    }).sort((a, b) => b.score - a.score);
    const results = ranked.slice(0, 50).map(item => item.track);
    if (!results.length && openverseFailed && audiusFailed && jamendoBatch.every(result => result.status === "rejected") && freeToUseBatch.every(result => result.status === "rejected") && archive.status === "rejected") {
      return NextResponse.json({ error: "Music search sources are temporarily unavailable. Please try again." }, { status: 502 });
    }
    return NextResponse.json({
      results,
      sources: { openverse: openverseResults.length, audius: audiusResults.length, jamendo: jamendoResults.length, freeToUse: freeToUseResults.length, internetArchive: archiveResults.length }
    }, { headers: { "Cache-Control": "public, s-maxage=180, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "Music search failed. Please try again." }, { status: 502 });
  }
}
