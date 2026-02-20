import { useState } from "react";
import Head from "next/head";

function getVideoId(url) {
  url = (url || "").trim();
  for (const p of [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/,
  ]) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  return null;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [loadMsg, setLoadMsg] = useState("");
  const [transcript, setTranscript] = useState("");
  const [stats, setStats] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleTranscribe() {
    const videoId = getVideoId(url);
    if (!videoId) {
      setErrMsg("Couldn't find a valid YouTube video ID in that URL.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrMsg("");
    setTranscript("");
    setLoadMsg("Searching for transcript…");

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrMsg(data.error || `Error ${res.status}`);
        setStatus("error");
        return;
      }

      const words = data.wordCount?.toLocaleString() || "—";
      const chars = data.transcript?.length?.toLocaleString() || "—";
      setStats(`${words} words · ${chars} chars`);
      setTranscript(data.transcript);
      setStatus("done");
    } catch (err) {
      setErrMsg("Network error — make sure you're connected and try again.");
      setStatus("error");
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(transcript).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const vid = getVideoId(url) || "yt";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([transcript], { type: "text/plain" }));
    a.download = `transcript-${vid}.txt`;
    a.click();
  }

  return (
    <>
      <Head>
        <title>YT Transcript</title>
        <meta name="description" content="Extract transcripts from any YouTube video" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400&family=DM+Sans:opsz,wght@9..40,300;9..40,400&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="wrap">
        {/* Header */}
        <header className="header">
          <h1 className="logo">TRANSCRIPT</h1>
          <p className="tagline">YouTube caption extractor · powered by Claude</p>
        </header>

        {/* URL Input */}
        <div className="field">
          <label className="label" htmlFor="urlInput">YouTube URL</label>
          <div className="input-row">
            <input
              id="urlInput"
              className="input"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && status !== "loading" && handleTranscribe()}
              placeholder="https://www.youtube.com/watch?v=...  or  https://youtu.be/..."
              autoComplete="off"
              spellCheck="false"
            />
            {url && (
              <button className="clear-btn" onClick={() => { setUrl(""); setStatus("idle"); }}>
                ×
              </button>
            )}
          </div>
        </div>

        {/* Transcribe Button */}
        <button
          className={`btn ${status === "loading" || !url.trim() ? "btn--disabled" : ""}`}
          onClick={handleTranscribe}
          disabled={status === "loading" || !url.trim()}
        >
          {status === "loading" ? loadMsg : "Transcribe"}
        </button>

        {/* Loading bar */}
        {status === "loading" && (
          <div className="loading-bar">
            <div className="loading-fill" />
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="error-box">{errMsg}</div>
        )}

        {/* Output */}
        {status === "done" && (
          <section className="output">
            <div className="output-header">
              <div className="output-meta">
                <span className="output-title">Transcript</span>
                <span className="output-stats">{stats}</span>
              </div>
              <div className="output-actions">
                <button
                  className={`act-btn ${copied ? "act-btn--ok" : ""}`}
                  onClick={handleCopy}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button className="act-btn" onClick={handleDownload}>
                  Download .txt
                </button>
              </div>
            </div>
            <div className="transcript-box">{transcript}</div>
          </section>
        )}

        <footer className="footer">
          <span>Uses YouTube captions via Claude web search</span>
          <span>{new Date().getFullYear()}</span>
        </footer>
      </div>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #0a0a0a;
          --surface: #111;
          --border: #1e1e1e;
          --border-hi: #2e2e2e;
          --accent: #e8ff47;
          --text: #f0f0f0;
          --muted: #555;
          --dim: #333;
          --green: #4dcc88;
          --red: #ff6b6b;
        }

        html, body {
          min-height: 100%;
          background: var(--bg);
          color: var(--text);
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          font-weight: 300;
          -webkit-font-smoothing: antialiased;
        }

        ::placeholder { color: var(--dim); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: var(--border-hi); }

        .wrap {
          max-width: 740px;
          margin: 0 auto;
          padding: 56px 24px 100px;
        }

        /* Header */
        .header {
          padding-bottom: 28px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 44px;
        }

        .logo {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 46px;
          color: var(--accent);
          letter-spacing: 0.03em;
          line-height: 1;
          font-weight: 400;
        }

        .tagline {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: var(--muted);
          margin-top: 7px;
        }

        /* Field */
        .field { margin-bottom: 6px; }

        .label {
          display: block;
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 9px;
        }

        .input-row { position: relative; }

        .input {
          width: 100%;
          background: var(--surface);
          border: 1px solid var(--border-hi);
          color: var(--text);
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          padding: 14px 40px 14px 18px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent);
        }

        .clear-btn {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--muted);
          font-size: 20px;
          cursor: pointer;
          line-height: 1;
          padding: 2px 4px;
          transition: color 0.15s;
        }
        .clear-btn:hover { color: var(--text); }

        /* Button */
        .btn {
          width: 100%;
          margin-top: 12px;
          padding: 17px;
          background: var(--accent);
          color: #0a0a0a;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 21px;
          letter-spacing: 0.08em;
          border: none;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }
        .btn:hover { opacity: 0.88; }
        .btn:active { transform: translateY(1px); }
        .btn--disabled {
          background: var(--border-hi);
          color: var(--muted);
          cursor: not-allowed;
          opacity: 1;
          transform: none;
        }

        /* Loading bar */
        .loading-bar {
          height: 2px;
          background: var(--border-hi);
          overflow: hidden;
          margin-top: 12px;
        }
        .loading-fill {
          height: 100%;
          background: var(--accent);
          animation: slide 1.4s ease-in-out infinite;
          transform-origin: left;
        }
        @keyframes slide {
          0%   { transform: scaleX(0) translateX(0); }
          50%  { transform: scaleX(0.65) translateX(60%); }
          100% { transform: scaleX(0) translateX(250%); }
        }

        /* Error */
        .error-box {
          margin-top: 14px;
          padding: 13px 18px;
          border: 1px solid rgba(255, 107, 107, 0.3);
          background: rgba(255, 107, 107, 0.05);
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: var(--red);
          line-height: 1.6;
        }

        /* Output */
        .output {
          margin-top: 40px;
          animation: fadeUp 0.35s ease both;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .output-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 16px;
        }

        .output-meta { display: flex; flex-direction: column; gap: 3px; }

        .output-title {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--accent);
        }

        .output-stats {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: var(--muted);
        }

        .output-actions { display: flex; gap: 8px; }

        .act-btn {
          background: var(--surface);
          border: 1px solid var(--border-hi);
          color: var(--muted);
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 7px 14px;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .act-btn:hover { border-color: #666; color: var(--text); }
        .act-btn--ok { border-color: var(--green); color: var(--green); }

        .transcript-box {
          background: var(--surface);
          border: 1px solid var(--border);
          padding: 26px 30px;
          max-height: 560px;
          overflow-y: auto;
          font-size: 15px;
          line-height: 1.9;
          color: #ccc;
          white-space: pre-wrap;
          word-break: break-word;
          scrollbar-width: thin;
          scrollbar-color: var(--border-hi) transparent;
        }

        /* Footer */
        .footer {
          margin-top: 72px;
          padding-top: 18px;
          border-top: 1px solid var(--border);
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: var(--dim);
          display: flex;
          justify-content: space-between;
        }
      `}</style>
    </>
  );
}
