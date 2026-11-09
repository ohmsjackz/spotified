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

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (raw.length < 2) return NextResponse.json({ results: [] });
  if (raw.length > 100) return NextResponse.json({ error: "Search is limited to 100 characters." }, { status: 400 });

  const safeTerms = raw.toLowerCase().match(/[a-z0-9]{2,}/g)?.slice(0,8) ?? [];
  if (!safeTerms.length) return NextResponse.json({ results: [] });
  const termClauses = safeTerms.flatMap(term => [`title:${term}`, `creator:${term}`, `subject:${term}`]);
  const licenseClause = ["licenseurl:*publicdomain*", "licenseurl:*creativecommons.org/licenses/by/4.0*", "licenseurl:*creativecommons.org/licenses/by-sa/4.0*"].join(" OR ");
  const query = `mediatype:audio AND (${licenseClause}) AND (${termClauses.join(" OR ")})`;
  const params = new URLSearchParams({ q: query, output: "json", rows: "100", page: "1" });
  for (const field of ["identifier", "title", "creator", "licenseurl", "year", "downloads"]) params.append("fl[]", field);
  params.append("sort[]", "downloads desc");

  try {
    const searchResponse = await fetch("https://archive.org/advancedsearch.php?" + params.toString(), {
      headers: { "User-Agent": "Spotified/1.0 (music search)" },
      signal: AbortSignal.timeout(12000),
      next: { revalidate: 300 }
    });
    if (!searchResponse.ok) throw new Error("The music catalogue search is unavailable.");
    const searchData = await searchResponse.json();
    const docs: ArchiveDoc[] = (searchData.response?.docs ?? []).filter((doc: ArchiveDoc) =>
      doc.identifier && doc.licenseurl && allowedLicense(doc.licenseurl)
    );

    const candidates = await Promise.all(docs.slice(0, 40).map(async (doc) => {
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
        // MP3, M4A/MP4 and WAV are broadly supported by current Safari and Chrome.
        const audioFiles = files.filter(file => {
          if (!file.name || file.private === "true" || file.source === "metadata") return false;
          return /\.(mp3|m4a|mp4|wav)$/i.test(file.name);
        });
        audioFiles.sort((a, b) => {
          const score = (file: ArchiveFile) => {
            const name = (file.name ?? "").toLowerCase();
            const format = (file.format ?? "").toLowerCase();
            return (name.endsWith(".mp3") ? 10 : 0) +
              (name.endsWith(".m4a") || name.endsWith(".mp4") ? 8 : 0) +
              (name.endsWith(".wav") ? 5 : 0) +
              (format.includes("vbr mp3") ? 2 : 0) +
              (file.source === "derivative" ? 1 : 0) +
              (Number(file.size || 0) > 100000 ? 1 : 0);
          };
          return score(b) - score(a);
        });
        const file = audioFiles[0];
        if (!file?.name) return null;
        const identifier = doc.identifier!;
        const artist = text(metadata.metadata?.creator) || text(doc.creator) || "Unknown artist";
        const title = text(metadata.metadata?.title) || text(doc.title) || identifier;
        const encodedFile = file.name.split("/").map(encodeURIComponent).join("/");
        return {
          id: "ia-" + identifier + "-" + file.name,
          title,
          artist,
          url: "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodedFile,
          artwork: "https://archive.org/services/img/" + encodeURIComponent(identifier),
          license: itemLicense,
          archiveUrl: "https://archive.org/details/" + encodeURIComponent(identifier)
        };
      } catch {
        return null;
      }
    }));

    return NextResponse.json({ results: candidates.filter(Boolean).slice(0, 30) }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Music search failed." }, { status: 502 });
  }
}
