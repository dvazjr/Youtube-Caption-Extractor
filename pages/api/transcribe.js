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
    console.error("[transcribe] FINAL ERROR:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

async function ytFetch(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "*/*",
      "Cookie": "SOCS=CAI; CONSENT=YES+cb;",
    },
    redirect: "follow",
  });
  console.log("[transcribe] fetch", url.slice(0, 80), "→", res.status);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.slice(0, 60)}`);
  return res.text();
}

async function getTranscript(videoId) {
  // Step 1: Get the list of available caption tracks from timedtext list API
  const listXml = await ytFetch(
    `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`
  );

  console.log("[transcribe] track list length:", listXml.length);
  console.log("[transcribe] track list preview:", listXml.slice(0, 300));

  // Parse available tracks from the list XML
  // Format: <track id="0" name="" lang_code="en" lang_default="true" kind="asr" .../>
  const trackMatches = [...listXml.matchAll(/<track\s+([^/]+)\/?>/g)];
  console.log("[transcribe] tracks found in list:", trackMatches.length);

  let trackUrl = null;

  if (trackMatches.length > 0) {
    // Find English track
    const getAttr = (str, attr) => str.match(new RegExp(`${attr}="([^"]+)"`))?.[1];

    const tracks = trackMatches.map(m => ({
      raw: m[1],
      lang: getAttr(m[1], "lang_code"),
      name: getAttr(m[1], "name") || "",
      kind: getAttr(m[1], "kind") || "manual",
      id: getAttr(m[1], "id") || "0",
    }));

    console.log("[transcribe] parsed tracks:", JSON.stringify(tracks.map(t => ({ lang: t.lang, kind: t.kind }))));

    const track =
      tracks.find(t => t.lang === "en" && t.kind !== "asr") ||
      tracks.find(t => t.lang === "en") ||
      tracks.find(t => t.lang?.startsWith("en")) ||
      tracks[0];

    if (track) {
      const name = encodeURIComponent(track.name);
      const kind = track.kind !== "manual" ? `&kind=${track.kind}` : "";
      trackUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${track.lang}&name=${name}${kind}&fmt=srv1`;
    }
  }

  // Step 2: Fallback — try common timedtext URLs directly if list was empty
  if (!trackUrl) {
    console.log("[transcribe] track list empty, trying direct URLs");
    const directUrls = [
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=srv1`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&kind=asr&lang=en&fmt=srv1`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&kind=asr&lang=en`,
    ];

    for (const url of directUrls) {
      try {
        const xml = await ytFetch(url);
        if (xml?.includes("<text")) {
          console.log("[transcribe] direct URL worked:", url);
          return parseXml(xml);
        }
      } catch (e) {
        console.log("[transcribe] direct URL failed:", e.message);
      }
    }
    throw new Error("No captions found. Make sure this video has CC enabled on YouTube.");
  }

  // Step 3: Fetch the actual caption XML
  const xml = await ytFetch(trackUrl);
  if (!xml?.includes("<text")) throw new Error("Caption XML returned but was empty");
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
