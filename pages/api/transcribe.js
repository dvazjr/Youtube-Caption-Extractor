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

async function getTranscript(videoId) {
  // ── Step 1: Use InnerTube API to get video metadata + caption URLs ──
  // This is what the YouTube iOS app uses internally - no HTML scraping
  const innertubeRes = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
        "X-YouTube-Client-Name": "5",
        "X-YouTube-Client-Version": "19.29.1",
        "Origin": "https://www.youtube.com",
        "Referer": "https://www.youtube.com/",
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "IOS",
            clientVersion: "19.29.1",
            deviceModel: "iPhone16,2",
            userAgent: "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;) gzip",
            hl: "en",
            gl: "US",
            timeZone: "America/New_York",
            utcOffsetMinutes: -240,
          },
        },
      }),
    }
  );

  if (!innertubeRes.ok) {
    throw new Error(`InnerTube API returned HTTP ${innertubeRes.status}`);
  }

  const player = await innertubeRes.json();
  console.log("[transcribe] playability:", player?.playabilityStatus?.status);

  const playability = player?.playabilityStatus?.status;
  if (playability === "LOGIN_REQUIRED") throw new Error("Video is age-restricted or private.");
  if (playability === "ERROR") throw new Error("Video not found or unavailable.");
  if (playability === "UNPLAYABLE") throw new Error("Video is unavailable in this region.");

  // ── Step 2: Get caption tracks ──
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks?.length) {
    throw new Error("No captions found. Make sure the video has CC available on YouTube.");
  }

  // Prefer manual English captions, fall back to auto-generated, then any language
  const track =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  console.log("[transcribe] using track:", track.languageCode, track.kind ?? "manual", track.name?.simpleText);

  // ── Step 3: Fetch caption XML ──
  const capUrl = track.baseUrl;
  const capRes = await fetch(capUrl, {
    headers: {
      "User-Agent": "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!capRes.ok) throw new Error(`Caption fetch returned HTTP ${capRes.status}`);
  const xml = await capRes.text();

  if (!xml?.includes("<text")) throw new Error("Caption data was empty");

  // ── Step 4: Parse XML to plain text ──
  return parseXml(xml);
}

function parseXml(xml) {
  const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
  const skip = new Set(["[Music]", "[Applause]", "[Laughter]", "♪", "[music]"]);
  const segs = [];
  let m;

  while ((m = re.exec(xml)) !== null) {
    const t = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n/g, " ")
      .trim();
    if (t && !skip.has(t)) segs.push(t);
  }

  if (!segs.length) throw new Error("No text found in captions");

  // Deduplicate consecutive identical lines (common in auto-captions)
  return segs.filter((s, i) => s !== segs[i - 1]).join(" ");
}
