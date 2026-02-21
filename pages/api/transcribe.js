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
    console.error("[transcribe]", err.message);
    return res.status(500).json({ error: err.message });
  }
}

// iOS YouTube app UA — YouTube doesn't challenge mobile app requests
const IOS_UA = "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)";

const HEADERS = {
  "User-Agent": IOS_UA,
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "*/*",
  // Bypass consent + cookie walls
  "Cookie": "SOCS=CAI; CONSENT=YES+cb.20210328-17-p0.en+FX+119; GPS=1;",
};

async function ytFetch(url) {
  // follow redirects automatically (fetch does this by default)
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`YouTube returned HTTP ${res.status} for ${url}`);
  return res.text();
}

async function getTranscript(videoId) {
  // ── Step 1: Try the timedtext API directly (no page scrape needed) ──
  const directVariants = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=srv1`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&kind=asr&lang=en&fmt=srv1`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&kind=asr&lang=en`,
  ];

  for (const url of directVariants) {
    try {
      const xml = await ytFetch(url);
      if (xml?.includes("<text")) {
        const text = parseXml(xml);
        if (text.length > 20) {
          console.log("[transcribe] direct timedtext success:", url);
          return text;
        }
      }
    } catch (e) {
      console.log("[transcribe] direct attempt failed:", e.message);
    }
  }

  // ── Step 2: Scrape page for caption track URL ──
  console.log("[transcribe] falling back to page scrape");
  const html = await ytFetch(
    `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1&hl=en`
  );

  // Pull ytInitialPlayerResponse
  const marker = "ytInitialPlayerResponse = ";
  const si = html.indexOf(marker);
  if (si === -1) throw new Error("Could not find player data in page");

  const js = html.slice(si + marker.length);
  let depth = 0, end = 0;
  for (let i = 0; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }

  let player;
  try { player = JSON.parse(js.slice(0, end)); }
  catch { throw new Error("Failed to parse player data"); }

  const playability = player?.playabilityStatus?.status;
  if (playability === "LOGIN_REQUIRED") throw new Error("Video is age-restricted or private.");
  if (playability === "ERROR") throw new Error("Video not found or unavailable.");

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error("No captions found on this video. Check that CC is available on YouTube.");

  const track =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  console.log("[transcribe] track:", track.languageCode, track.kind ?? "manual");

  const xml = await ytFetch(track.baseUrl + "&fmt=srv1");
  if (!xml?.includes("<text")) throw new Error("Caption XML was empty");

  return parseXml(xml);
}

function parseXml(xml) {
  const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
  const segs = [];
  let m;
  const skip = new Set(["[Music]", "[Applause]", "[Laughter]", "♪", "[music]"]);
  while ((m = re.exec(xml)) !== null) {
    const t = m[1]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " ").trim();
    if (t && !skip.has(t)) segs.push(t);
  }
  if (!segs.length) throw new Error("No text found in captions");
  return segs.filter((s, i) => s !== segs[i - 1]).join(" ");
}
