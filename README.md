# No-Website Business Finder

A small web app built for **Gideon Moffitt Web Design** that finds local businesses
which appear to have no website — ideal leads for a web designer to pitch.

It calls the **Anthropic API** with the server-side
[`web_search_20250305`](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search-tool)
tool, using model **`claude-sonnet-4-5-20250929`**, and renders results as cards with
name, address, phone, source, confidence, reason, and a pitch tip. Export to CSV.

## Run locally

Requires Python 3.10+.

```bash
# 1. Install deps
pip install -r requirements.txt

# 2. Set your Anthropic API key as an env var
export ANTHROPIC_API_KEY="sk-ant-..."

# 3. Start the app
python app.py

# 4. Open http://127.0.0.1:5000
```

Enter a city (e.g. `Asheville, NC`) and a business niche (e.g. `house cleaners`),
then click **Search**. A run typically takes 20–60 seconds because the model is
actually searching the web (up to 8 searches per request).

## How it works

- `app.py` — Flask server. `POST /api/search` calls
  `client.messages.create(...)` with the `web_search_20250305` server tool enabled.
  The model runs searches, then returns a single JSON object describing qualifying
  businesses. The server parses it and forwards it to the UI.
- `static/index.html`, `static/styles.css`, `static/app.js` — dark-theme UI with
  the `#00FF94` accent, the **Gideon Moffitt Web Design** header, result cards,
  and a client-side CSV export.

## Notes

- Web search is billed at $10 per 1,000 searches plus standard token costs.
- The model is instructed to exclude any business with a real owned domain and to
  rate confidence High / Medium / Low based on how thoroughly it verified.
- Results are only as good as what the public web indexes — always double-check
  before pitching.
