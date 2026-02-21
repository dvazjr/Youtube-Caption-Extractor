import https from "https";

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

// Promisified https.get
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        "User-Agent":
          "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
        "Accept-Language": "en-US,en;q=0.9",
        ...headers,
      },
    };
    https
      .get(url, opts, (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () =>
          resolve({
            status: r.statusCode,
            body: Buffer.concat(chunks).toString(),
          }),
        );
        r.on("error", reject);
      })
      .on("error", reject);
  });
}

async function getTranscript(videoId) {
  // Use the iOS YouTube client — much harder for YouTube to block than browser UA
  // Fetch video page
  const { status, body: html } = await httpsGet(
    `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`,
    { Cookie: "SOCS=CAI; GPS=1" },
  );

  if (status !== 200) throw new Error(`YouTube returned HTTP ${status}`);

  // Extract ytInitialPlayerResponse
  const marker = "ytInitialPlayerResponse = ";
  const si = html.indexOf(marker);
  if (si === -1) throw new Error("Could not find player response in page");

  const js = html.slice(si + marker.length);
  let depth = 0,
    end = 0;
  for (let i = 0; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  let player;
  try {
    player = JSON.parse(js.slice(0, end));
  } catch {
    throw new Error("Failed to parse player response");
  }

  // Get caption tracks
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) {
    // Try to give a useful reason
    const status = player?.playabilityStatus;
    if (status?.status === "LOGIN_REQUIRED")
      throw new Error("This video is age-restricted or private.");
    if (status?.status === "ERROR")
      throw new Error("Video not found or unavailable.");
    throw new Error(
      "No captions found. Make sure the video has CC enabled on YouTube.",
    );
  }

  // Pick English track
  const track =
    tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  console.log(
    "[transcribe] track:",
    track.languageCode,
    track.kind ?? "manual",
    track.name?.simpleText,
  );

  // Fetch caption XML
  const capUrl = track.baseUrl + "&fmt=srv1";
  const { status: capStatus, body: xml } = await httpsGet(capUrl);
  if (capStatus !== 200)
    throw new Error(`Caption fetch returned HTTP ${capStatus}`);
  if (!xml.includes("<text")) throw new Error("Caption XML was empty");

  // Parse XML
  const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
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
    if (
      t &&
      !["[Music]", "[Applause]", "[Laughter]", "♪", "[music]"].includes(t)
    ) {
      segs.push(t);
    }
  }

  if (!segs.length) throw new Error("Transcript was empty after parsing");

  return segs.filter((s, i) => s !== segs[i - 1]).join(" ");
}
