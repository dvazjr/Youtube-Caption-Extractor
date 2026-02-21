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
    return res.status(500).json({ error: err.message });
  }
}

async function fetchXml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseXmlToText(xml) {
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
    if (text && !["[Music]", "[Applause]", "[Laughter]"].includes(text)) {
      segments.push(text);
    }
  }
  // Deduplicate consecutive identical lines (auto-caption artifact)
  return segments.filter((s, i) => s !== segments[i - 1]).join(" ");
}

async function getTranscript(videoId) {
  // Try these caption URL variants in order
  const variants = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=srv1`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=srv1`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-GB&fmt=srv1`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&kind=asr&lang=en&fmt=srv1`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&kind=asr&lang=en`,
  ];

  for (const url of variants) {
    try {
      const xml = await fetchXml(url);
      if (xml && xml.includes("<text")) {
        const text = parseXmlToText(xml);
        if (text.length > 20) return text;
      }
    } catch (_) {
      // try next variant
    }
  }

  // Last resort: scrape the page to get the actual caption track URL
  return await scrapeAndFetch(videoId);
}

async function scrapeAndFetch(videoId) {
  // Fetch with cookie consent bypass
  const pageRes = await fetch(
    `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: "CONSENT=YES+cb; YSC=1; VISITOR_INFO1_LIVE=1",
      },
    },
  );

  if (!pageRes.ok) throw new Error(`YouTube page returned ${pageRes.status}`);
  const html = await pageRes.text();

  // Find ytInitialPlayerResponse
  const marker = "ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);
  if (start === -1) {
    throw new Error(
      "Could not parse YouTube page. The video may be unavailable in this region.",
    );
  }

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

  const tracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks || tracks.length === 0) {
    throw new Error(
      "No captions found. The video may not have captions enabled.",
    );
  }

  const track =
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks[0];

  if (!track?.baseUrl) throw new Error("Caption URL not found in player data");

  const xml = await fetchXml(track.baseUrl);
  if (!xml || !xml.includes("<text")) throw new Error("Caption data was empty");

  const text = parseXmlToText(xml);
  if (!text) throw new Error("Could not extract text from captions");
  return text;
}
