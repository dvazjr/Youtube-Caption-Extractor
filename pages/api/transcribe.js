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
  // Try multiple InnerTube client contexts — different clients have different access
  const clients = [
    {
      name: "ANDROID",
      clientName: "ANDROID",
      clientVersion: "18.11.34",
      androidSdkVersion: 30,
      userAgent: "com.google.android.youtube/18.11.34 (Linux; U; Android 11) gzip",
      apiKey: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
      xClientName: "3",
    },
    {
      name: "WEB",
      clientName: "WEB",
      clientVersion: "2.20240101.00.00",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      xClientName: "1",
    },
    {
      name: "TV_EMBEDDED",
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1",
      apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
      xClientName: "85",
    },
  ];

  let lastError = "";

  for (const client of clients) {
    try {
      console.log("[transcribe] trying client:", client.name);
      const player = await callInnertube(videoId, client);
      const playability = player?.playabilityStatus?.status;
      console.log("[transcribe] playability:", playability);

      if (playability === "LOGIN_REQUIRED") throw new Error("Video is age-restricted or private.");
      if (playability === "ERROR") throw new Error("Video not found or unavailable.");

      const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!tracks?.length) {
        lastError = "No captions found. Make sure CC is available on YouTube for this video.";
        continue;
      }

      const track =
        tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ||
        tracks.find((t) => t.languageCode === "en") ||
        tracks.find((t) => t.languageCode?.startsWith("en")) ||
        tracks[0];

      console.log("[transcribe] track:", track.languageCode, track.kind ?? "manual");

      const capRes = await fetch(track.baseUrl, {
        headers: { "User-Agent": client.userAgent },
      });

      if (!capRes.ok) throw new Error(`Caption fetch returned HTTP ${capRes.status}`);
      const xml = await capRes.text();
      if (!xml?.includes("<text")) throw new Error("Caption XML was empty");

      return parseXml(xml);
    } catch (err) {
      console.log("[transcribe] client", client.name, "failed:", err.message);
      lastError = err.message;
    }
  }

  throw new Error(lastError || "Could not retrieve transcript after trying all methods.");
}

async function callInnertube(videoId, client) {
  const body = {
    videoId,
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        hl: "en",
        gl: "US",
        ...(client.androidSdkVersion && { androidSdkVersion: client.androidSdkVersion }),
      },
    },
  };

  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${client.apiKey}&prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": client.userAgent,
        "X-YouTube-Client-Name": client.xClientName,
        "X-YouTube-Client-Version": client.clientVersion,
        "Origin": "https://www.youtube.com",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) throw new Error(`InnerTube HTTP ${res.status} with client ${client.name}`);
  return res.json();
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
