export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { videoId } = req.body;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  try {
    const transcript = await getTranscript(videoId);
    const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    return res.status(200).json({ transcript, wordCount });
  } catch (err) {
    console.error("Transcript error:", err.message);
    return res
      .status(500)
      .json({ error: err.message || "Could not fetch transcript" });
  }
}

async function getTranscript(videoId) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // 1. Fetch the YouTube page
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers,
  });
  if (!pageRes.ok) throw new Error(`YouTube page returned ${pageRes.status}`);
  const html = await pageRes.text();

  // 2. Pull out ytInitialPlayerResponse JSON
  const marker = "ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);
  if (start === -1)
    throw new Error("Could not find player data on YouTube page");

  const jsonStart = start + marker.length;
  let depth = 0,
    end = jsonStart;
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  let playerData;
  try {
    playerData = JSON.parse(html.slice(jsonStart, end));
  } catch {
    throw new Error("Could not parse YouTube player data");
  }

  // 3. Get caption tracks
  const tracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks || tracks.length === 0) {
    throw new Error(
      "No captions available for this video. The creator may not have enabled captions.",
    );
  }

  // 4. Prefer English, fall back to first available
  const track =
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  const baseUrl = track.baseUrl;
  if (!baseUrl) throw new Error("Caption track URL not found");

  // 5. Fetch the caption XML
  const capRes = await fetch(baseUrl, { headers });
  if (!capRes.ok) throw new Error(`Caption fetch returned ${capRes.status}`);
  const xml = await capRes.text();

  // 6. Parse XML into plain text
  const segments = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n/g, " ")
      .trim();
    if (text && text !== "[Music]" && text !== "[Applause]") {
      segments.push(text);
    }
  }

  if (segments.length === 0) throw new Error("Transcript was empty");

  // 7. Deduplicate consecutive identical segments (common in auto-captions)
  const deduped = segments.filter((s, i) => s !== segments[i - 1]);

  return deduped.join(" ");
}
