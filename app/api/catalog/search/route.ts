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

  const safeTerms = raw.replace(/[+\-!(){}\[\]^"~*?:\\/]/g, " ").split(/\s+/).filter(Boolean);
  if (!safeTerms.length) return NextResponse.json({ results: [] });
  const query = "mediatype:audio AND " + safeTerms.map(term => '"' + term.replace(/"/g, "") + '"').join(" AND ");
  const params = new URLSearchParams({ q: query, output: "json", rows: "60", page: "1" });
  for (const field of ["identifier", "title", "creator", "licenseurl", "year", "downloads"]) params.append("fl[]", field);

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

    const candidates = await Promise.all(docs.slice(0, 24).map(async (doc) => {
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
        const audioFiles = files.filter(file =>
          file.name && file.name.toLowerCase().endsWith(".mp3") &&
          file.private !== "true" && file.source !== "metadata"
        );
        audioFiles.sort((a, b) => {
          const score = (file: ArchiveFile) =>
            (file.format?.toLowerCase().includes("vbr mp3") ? 4 : 0) +
            (file.source === "derivative" ? 2 : 0) +
            (Number(file.size || 0) > 100000 ? 1 : 0);
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

    return NextResponse.json({ results: candidates.filter(Boolean).slice(0, 20) }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Music search failed." }, { status: 502 });
  }
}
