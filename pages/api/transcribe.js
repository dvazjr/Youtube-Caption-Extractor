import { YoutubeTranscript } from "youtube-transcript";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { videoId } = req.body;

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  try {
    // Fetch transcript directly from YouTube — no API key needed
    const segments = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: "en",
    });

    if (!segments || segments.length === 0) {
      return res.status(404).json({
        error: "No transcript found. The video may not have captions enabled, or may be private/age-restricted.",
      });
    }

    // Join all segments into clean plain text
    // Deduplicate consecutive repeated phrases (common in auto-captions)
    const words = [];
    let lastText = "";
    for (const seg of segments) {
      const text = seg.text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\n/g, " ")
        .trim();

      if (text && text !== lastText && text !== "[Music]" && text !== "[Applause]") {
        words.push(text);
        lastText = text;
      }
    }

    const transcript = words.join(" ");
    const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;

    return res.status(200).json({ transcript, wordCount });
  } catch (err) {
    console.error("Transcript fetch error:", err);

    const msg = err.message || "";

    if (msg.includes("disabled") || msg.includes("no transcript")) {
      return res.status(404).json({
        error: "This video doesn't have captions available.",
      });
    }

    if (msg.includes("private") || msg.includes("age")) {
      return res.status(403).json({
        error: "This video is private or age-restricted and cannot be transcribed.",
      });
    }

    return res.status(500).json({
      error: "Could not fetch transcript. The video may not have captions enabled.",
    });
  }
}
