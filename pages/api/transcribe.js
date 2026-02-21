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
  // TVHTML5_SIMPLY_EMBEDDED_PLAYER with thirdParty.embedUrl bypasses
  // LOGIN_REQUIRED on public videos — embedded players skip auth checks
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "X-YouTube-Client-Name": "85",
      "X-YouTube-Client-Version": "2.0",
      "Origin": "https://www.youtube.com",
      "Referer": `https://www.youtube.com/watch?v=${videoId}`,
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
          clientVersion: "2.0",
          hl: "en",
          gl: "US",
        },
        thirdParty: {
          embedUrl: "https://www.youtube.com/",
        },
      },
    }),
  });

  console.log("[transcribe] innertube status:", res.status);
  if (!res.ok) throw new Error(`InnerTube returned HTTP ${res.status}`);

  const player = await res.json();
  const playability = player?.playabilityStatus?.status;
  console.log("[transcribe] playability:", playability);

  if (playability === "LOGIN_REQUIRED") {
    throw new Error("Video is private or age-restricted and cannot be accessed.");
  }
  if (playability === "ERROR" || playability === "UNPLAYABLE") {
    throw new Error("Video is unavailable.");
  }

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  console.log("[transcribe] caption tracks found:", tracks?.length ?? 0);

  if (!tracks?.length) {
    throw new Error("No captions found. Make sure CC is available on YouTube for this video.");
  }

  // Prefer manual English, then auto-generated English, then first available
  const track =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  console.log("[transcribe] using track:", track.languageCode, track.kind ?? "manual");

  const capRes = await fetch(track.baseUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!capRes.ok) throw new Error(`Caption fetch returned HTTP ${capRes.status}`);
  const xml = await capRes.text();
  if (!xml?.includes("<text")) throw new Error("Caption XML was empty");

  return parseXml(xml);
}

function parseXml(xml) {
  const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
  const skip = new Set(["[Music]", "[Applause]", "[Laughter]", "♪", "[music]"]);
  const segs = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = m[1]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n/g, " ").trim();
    if (t && !skip.has(t)) segs.push(t);
  }
  if (!segs.length) throw new Error("No text found in captions");
  return segs.filter((s, i) => s !== segs[i - 1]).join(" ");
}
