"""No-Website Business Finder — Flask backend.

Uses the Anthropic API with the server-side `web_search_20250305` tool to find
local businesses without a website. Model: claude-sonnet-4-5-20250929.
"""

import json
import os
import re
import time
from pathlib import Path

import anthropic
from flask import Flask, jsonify, request, send_from_directory

STATIC_DIR = Path(__file__).parent / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")

MODEL = "claude-sonnet-4-5-20250929"

SYSTEM_PROMPT = """You are a local business research assistant helping a web designer \
find small businesses that do NOT appear to have a website.

Workflow for every request:
1. Use the web_search tool (you may run multiple searches) to look for businesses \
matching the user's niche in the user's city. Search directories like Yelp, \
Google Maps listings, Yellow Pages, Facebook pages, Chamber of Commerce listings, \
Nextdoor, local news, etc.
2. For each candidate, confirm by searching for "<business name> <city> website" \
or the business name on its own. A business qualifies as "no website" if:
   - No results point to an owned domain (only social media, Yelp, Facebook, \
directory listings, or no listing at all), OR
   - Search returns a Facebook page / Instagram / Linktree as the only web presence.
3. Exclude any business that clearly has its own website domain.
4. Collect at least 5 qualifying businesses when possible.

After your research, output ONE final message that contains a single ```json fenced \
code block — and nothing else outside the code block — matching this schema exactly:

{
  "businesses": [
    {
      "name": "string — business name",
      "address": "string — full street address or 'Unknown'",
      "phone": "string — phone number or 'Unknown'",
      "source": "string — URL of the directory listing you found them on",
      "confidence": "High | Medium | Low",
      "reason": "string — one sentence explaining why you believe they have no website",
      "pitch_tip": "string — one sentence of advice for pitching web design to this business"
    }
  ]
}

Rules:
- Do NOT invent businesses. If web search returns nothing usable, return {"businesses": []}.
- Confidence = High when you searched the exact business name and found zero owned-domain \
results; Medium when only social pages exist; Low when you are unsure.
- pitch_tip should be specific (mention the niche, neighborhood, or a concrete angle).
- Output nothing after the closing ``` fence.
"""


def _extract_json(text: str) -> dict:
    """Pull the first JSON object out of the model's final text."""
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    raw = fenced.group(1) if fenced else None
    if raw is None:
        brace = re.search(r"\{.*\}", text, re.DOTALL)
        raw = brace.group(0) if brace else None
    if raw is None:
        return {"businesses": []}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"businesses": []}


def _final_text(message) -> str:
    parts = []
    for block in message.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "\n".join(parts)


def _search_queries_used(message) -> list:
    queries = []
    for block in message.content:
        if getattr(block, "type", None) == "server_tool_use" and getattr(block, "name", "") == "web_search":
            q = getattr(block, "input", {}) or {}
            if isinstance(q, dict) and q.get("query"):
                queries.append(q["query"])
    return queries


@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/api/search", methods=["POST"])
def api_search():
    data = request.get_json(silent=True) or {}
    city = (data.get("city") or "").strip()
    niche = (data.get("niche") or "").strip()

    if not city or not niche:
        return jsonify({"error": "Both 'city' and 'niche' are required."}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY environment variable is not set."}), 500

    client = anthropic.Anthropic(api_key=api_key)

    user_prompt = (
        f"City: {city}\n"
        f"Niche: {niche}\n\n"
        "Find local businesses in this city matching this niche that do NOT have a website. "
        "Follow the system instructions exactly and return the JSON object."
    )


    max_retries = 3
    retry_delay = 5
    message = None

    for attempt in range(max_retries):
        try:
            message = client.messages.create(
                model=MODEL,
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                tools=[
                    {
                        "type": "web_search_20250305",
                        "name": "web_search",
                        "max_uses": 5,
                    }
                ],
                messages=[{"role": "user", "content": user_prompt}],
            )
            break
        except anthropic.APIStatusError as e:
            if e.status_code == 529 and attempt < max_retries - 1:
                time.sleep(retry_delay)
                continue
            return jsonify({"error": f"Anthropic API error: {e.message}"}), 502
        except anthropic.APIError as e:
            return jsonify({"error": f"Anthropic API error: {str(e)}"}), 502

    if message is None:
        return jsonify({"error": "API overloaded after retries. Please try again."}), 502


    if message.stop_reason not in ("end_turn", "stop_sequence"):
        return jsonify({
            "error": f"Model stopped with reason '{message.stop_reason}' before returning results.",
            "queries": _search_queries_used(message),
        }), 502

    parsed = _extract_json(_final_text(message))
    businesses = parsed.get("businesses", []) if isinstance(parsed, dict) else []

    return jsonify({
        "city": city,
        "niche": niche,
        "queries": _search_queries_used(message),
        "businesses": businesses,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=True)
