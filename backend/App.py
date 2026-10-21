import base64
import io
import json
import math
import os
import sqlite3
import time
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, render_template_string
from flask_cors import CORS
from PIL import Image, UnidentifiedImageError
from google import genai
from google.genai import types


# ==========================================================
# 1. CONFIGURATION
# ==========================================================

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)

# -------------------- AUDIT HISTORY DATABASE --------------------

DATABASE_PATH = BASE_DIR / "designlens_history.db"


def get_db_connection():
    """Create a connection to the audit history database."""
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    """Create the audit history table if it doesn't already exist."""
    connection = get_db_connection()

    try:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                filename TEXT,
                score INTEGER NOT NULL,
                summary TEXT NOT NULL,
                findings_json TEXT NOT NULL,
                image_metadata_json TEXT,
                image_data BLOB
            )
        """)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(audits)").fetchall()}
        if "report_name" not in columns:
            connection.execute("ALTER TABLE audits ADD COLUMN report_name TEXT")
        # Backfill useful names for audits already saved in the database.
        rows = connection.execute("SELECT id, filename FROM audits WHERE report_name IS NULL OR TRIM(report_name) = ''").fetchall()
        for row in rows:
            filename = (row["filename"] or "").replace("\\", "/").split("/")[-1]
            stem = filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").strip()
            report_name = f"UI Audit — {stem}" if stem else f"Design Audit #{row['id']:03d}"
            connection.execute("UPDATE audits SET report_name = ? WHERE id = ?", (report_name, row["id"]))
        connection.commit()
    finally:
        connection.close()


def save_audit(filename, report_name, result, image_bytes):
    """Persist one completed audit and return its database ID."""
    connection = get_db_connection()
    try:
        cursor = connection.execute(
            """
            INSERT INTO audits (
                filename, report_name, score, summary, findings_json,
                image_metadata_json, image_data
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                filename,
                report_name.strip(),
                int(result["score"]),
                result["summary"],
                json.dumps(result.get("findings", []), ensure_ascii=False),
                json.dumps(result.get("image_metadata", {}), ensure_ascii=False),
                sqlite3.Binary(image_bytes),
            ),
        )
        connection.commit()
        return cursor.lastrowid
    finally:
        connection.close()



CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            ]
        }
    },
)

# Maximum uploaded image size: 5 MB.
MAX_IMAGE_SIZE = 5 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = MAX_IMAGE_SIZE

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}

MIME_TYPES = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}

ALLOWED_SEVERITIES = {"High", "Medium", "Low", "Info"}

ALLOWED_CATEGORIES = {
    "Layout",
    "Typography",
    "Color",
    "Navigation",
    "Accessibility",
    "Consistency",
    "Usability",
}


# ==========================================================
# 2. AI ANALYSIS PROMPT
# ==========================================================


PROMPT = """
You are DesignLens, an AI-powered visual UI/UX auditor.

Carefully inspect the supplied screenshot and identify distinct,
actionable design issues supported by visible evidence.

Evaluate:
- Visual hierarchy and layout
- Typography and readability
- Spacing, alignment and consistency
- Colours and potential contrast concerns
- Navigation and visible interaction cues
- Usability and visible accessibility concerns
- Content clarity and feedback states

Return 4 to 6 distinct findings when the screenshot contains enough
evidence. Return fewer when fewer genuine issues are visible. Never
invent issues or repeat the same issue under different titles.
Prefer specific observations over vague or generic advice.

Return ONLY valid JSON in this structure:
{
  "score": 75,
  "summary": "A concise overall assessment.",
  "findings": [
    {
      "id": "F1",
      "title": "Short, specific issue title",
      "category": "Layout",
      "description": "Describe the visible evidence.",
      "recommendation": "Give a practical improvement.",
      "severity": "Medium",
      "impact": "Explain the potential user impact.",
      "bounding_box": {
        "x": 100,
        "y": 100,
        "width": 200,
        "height": 150
      }
    }
  ]
}

Rules:
- Score must be an integer from 0 to 100.
- Severity must be High, Medium, Low, or Info.
- Category must be Layout, Typography, Color, Navigation,
  Accessibility, Consistency, or Usability.
- Keep descriptions and recommendations concise but useful.
- Use only evidence visible in the screenshot.
- Coordinates use a 0-1000 scale relative to the full image.
- Each bounding box should cover the relevant issue only.
- Return null for bounding_box if no specific region applies.
- Do not invent contrast ratios or claim WCAG compliance from an
  image alone.
- Return valid JSON only, without Markdown fences.
"""

# ==========================================================
# 3. HOMEPAGE
# ==========================================================

@app.get("/")
def home():
    return render_template_string("""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>DesignLens | AI-Powered UX Analysis</title>

    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: Inter, Arial, sans-serif;
            background: #0b0d12;
            color: #f5f5f7;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 24px 8%;
            border-bottom: 1px solid #252832;
        }

        .brand {
            font-size: 22px;
            font-weight: 750;
            letter-spacing: -1px;
        }

        .brand span {
            color: #a78bfa;
        }

        .status {
            font-size: 12px;
            color: #86efac;
            border: 1px solid #28563b;
            background: #14251b;
            border-radius: 30px;
            padding: 9px 13px;
        }

        main {
            width: min(1000px, 88%);
            margin: auto;
            padding: 75px 0;
            text-align: center;
        }

        .eyebrow {
            color: #c4b5fd;
            text-transform: uppercase;
            letter-spacing: 3px;
            font-size: 11px;
            font-weight: 700;
            margin-bottom: 24px;
        }

        h1 {
            font-size: clamp(42px, 8vw, 76px);
            line-height: 1.08;
            letter-spacing: -4px;
            margin-bottom: 24px;
        }

        h1 span {
            color: #a78bfa;
        }

        .description {
            max-width: 660px;
            margin: 0 auto;
            color: #a4a7b4;
            font-size: 17px;
            line-height: 1.8;
        }

        .actions {
            display: flex;
            justify-content: center;
            flex-wrap: wrap;
            gap: 14px;
            margin-top: 36px;
        }

        .button {
            display: inline-block;
            text-decoration: none;
            padding: 15px 23px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 700;
            transition: transform .2s, opacity .2s;
        }

        .button:hover {
            transform: translateY(-2px);
            opacity: .9;
        }

        .primary {
            color: #111018;
            background: #c4b5fd;
        }

        .secondary {
            color: #f5f5f7;
            border: 1px solid #353846;
            background: #171922;
        }

        .features {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin-top: 65px;
            text-align: left;
        }

        .feature {
            padding: 24px;
            background: #13151d;
            border: 1px solid #282b36;
            border-radius: 15px;
        }

        .feature-number {
            color: #a78bfa;
            font-size: 12px;
            margin-bottom: 18px;
        }

        .feature h2 {
            font-size: 16px;
            margin-bottom: 10px;
        }

        .feature p {
            font-size: 13px;
            line-height: 1.7;
            color: #a4a7b4;
        }

        footer {
            text-align: center;
            padding: 24px;
            color: #777b89;
            border-top: 1px solid #252832;
            font-size: 12px;
            line-height: 1.8;
        }

        @media (max-width: 650px) {
            nav {
                padding: 20px 6%;
            }

            main {
                padding: 55px 0;
            }

            h1 {
                letter-spacing: -2px;
            }

            .features {
                grid-template-columns: 1fr;
                margin-top: 45px;
            }
        }
    </style>
</head>

<body>
    <nav>
        <div class="brand">Design<span>Lens.</span></div>
        <div class="status">● API SERVER ONLINE</div>
    </nav>

    <main>
        <p class="eyebrow">AI-assisted design intelligence</p>

        <h1>
            See your interface<br>
            through a <span>better lens.</span>
        </h1>

        <p class="description">
            Analyze interface screenshots, identify potential usability
            issues, review visual hierarchy, and receive actionable
            suggestions for better user experiences.
        </p>

        <div class="actions">
            <a class="button primary"
               href="http://localhost:5173/">
                Open DesignLens Dashboard →
            </a>

            <a class="button secondary" href="/api/health">
                Check API Status →
            </a>
        </div>

        <section class="features">
            <article class="feature">
                <p class="feature-number">01 / ANALYZE</p>
                <h2>Visual UX Review</h2>
                <p>
                    Review layout, spacing, typography and visual hierarchy.
                </p>
            </article>

            <article class="feature">
                <p class="feature-number">02 / IDENTIFY</p>
                <h2>Evidence-Based Findings</h2>
                <p>
                    Connect potential interface issues to visible regions
                    of the screenshot.
                </p>
            </article>

            <article class="feature">
                <p class="feature-number">03 / IMPROVE</p>
                <h2>Actionable Feedback</h2>
                <p>
                    Get practical recommendations and image metadata
                    to support design reviews.
                </p>
            </article>
        </section>
    </main>

    <footer>
        DesignLens · AI-Based UI/UX Evaluation and Accessibility Analysis
        <br>
        An academic prototype. AI-generated findings require human review.
    </footer>
</body>
</html>
""")


# ==========================================================
# 4. API HEALTH CHECK
# ==========================================================

@app.get("/api/health")
def health():
    return jsonify({
        "service": "DesignLens API",
        "status": "ok",
        "gemini_configured": bool(
            os.getenv("GEMINI_API_KEY", "").strip()
        ),
    })


# ==========================================================
# 5. HELPER: NORMALIZE BOUNDING BOXES
# ==========================================================

def clean_bounding_box(box):
    """
    Validate a bounding box returned by Gemini.

    Coordinates use a 0-1000 scale relative to the
    original image. Invalid boxes become None.
    """

    if not isinstance(box, dict):
        return None

    try:
        x = float(box["x"])
        y = float(box["y"])
        width = float(box["width"])
        height = float(box["height"])

        values = [x, y, width, height]

        if not all(math.isfinite(value) for value in values):
            return None

        if not (
            0 <= x <= 1000
            and 0 <= y <= 1000
            and 0 < width <= 1000
            and 0 < height <= 1000
            and x + width <= 1000
            and y + height <= 1000
        ):
            return None

        return {
            "x": round(x, 2),
            "y": round(y, 2),
            "width": round(width, 2),
            "height": round(height, 2),
        }

    except (KeyError, TypeError, ValueError, OverflowError):
        return None


# ==========================================================
# 6. HELPER: CLEAN AI FINDINGS
# ==========================================================

def clean_findings(findings):
    """
    Keep the API response predictable for the React frontend.
    """

    if not isinstance(findings, list):
        raise ValueError("Gemini returned invalid findings.")

    cleaned = []

    for index, finding in enumerate(findings[:4], start=1):
        if not isinstance(finding, dict):
            continue

        severity = str(
            finding.get("severity", "Info")
        ).strip().title()

        if severity not in ALLOWED_SEVERITIES:
            severity = "Info"

        category = str(
            finding.get("category", "Usability")
        ).strip().title()

        if category not in ALLOWED_CATEGORIES:
            category = "Usability"

        title = str(
            finding.get("title", "UX observation")
        ).strip()[:180]

        description = str(
            finding.get("description", "")
        ).strip()[:1000]

        recommendation = str(
            finding.get(
                "recommendation",
                "Review this element and consider an improvement.",
            )
        ).strip()[:1000]

        impact = str(
            finding.get("impact", "")
        ).strip()[:500]

        cleaned.append({
            "id": str(finding.get("id", f"F{index}"))[:30],
            "title": title or "UX observation",
            "category": category,
            "description": description,
            "recommendation": recommendation,
            "severity": severity,
            "impact": impact,
            "bounding_box": clean_bounding_box(
                finding.get("bounding_box")
            ),
        })

    return cleaned


# ==========================================================
# 7. GEMINI AI ANALYSIS
# ==========================================================

def analyze_with_gemini(image_bytes, mime_type):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    model = os.getenv(
        "GEMINI_MODEL",
        "gemini-3.8-flash",
    ).strip().strip('"').strip("'")

    # Accept either "gemini-..." or "models/gemini-...".
    if model.startswith("models/"):
        model = model.removeprefix("models/")

    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is missing. Check backend/.env."
        )

    if not model:
        raise RuntimeError(
            "GEMINI_MODEL is empty. Check backend/.env."
        )

    client = genai.Client(api_key=api_key)

    start_time = time.perf_counter()

    try:
        response = client.models.generate_content(
            model=model,
            contents=[
                PROMPT,
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime_type,
                ),
            ],
            config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
            max_output_tokens=1800,
        ),
        )
    finally:
        elapsed = time.perf_counter() - start_time
        print(f"Gemini response time: {elapsed:.2f} seconds")

    if not response.text:
        raise ValueError("Gemini returned an empty response.")

    print("GEMINI RAW RESPONSE:", repr(response.text))
    result = json.loads(response.text)

    if not isinstance(result, dict):
        raise ValueError("Gemini returned an invalid JSON object.")

    score = result.get("score")

    if (
        isinstance(score, bool)
        or not isinstance(score, (int, float))
        or not math.isfinite(score)
    ):
        raise ValueError("Gemini returned an invalid score.")

    result["score"] = max(0, min(100, round(score)))

    result["summary"] = str(
        result.get("summary", "Analysis completed.")
    ).strip()[:1500]

    result["findings"] = clean_findings(
        result.get("findings", [])
    )

    result["analysis_mode"] = "gemini_ai"

    return result


# ==========================================================
# 8. SCREENSHOT ANALYSIS ENDPOINT
# ==========================================================

@app.post("/api/analyze")
def analyze():
    # ------------------------------------------------------
    # A. Check whether an image was uploaded
    # ------------------------------------------------------

    uploaded_file = request.files.get("image")
    report_name = (request.form.get("report_name") or "").strip()

    if not report_name:
        return jsonify({"error": "Please name this audit before starting the analysis."}), 400
    if len(report_name) > 90:
        return jsonify({"error": "Audit names must be 90 characters or fewer."}), 400

    if not uploaded_file or not uploaded_file.filename:
        return jsonify({
            "error": "Please upload an image."
        }), 400

    extension = Path(
        uploaded_file.filename
    ).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": "Unsupported image type. Use PNG, JPG or WEBP."
        }), 400

    # ------------------------------------------------------
    # B. Read and validate image bytes
    # ------------------------------------------------------

    image_bytes = uploaded_file.read()

    if not image_bytes:
        return jsonify({
            "error": "The uploaded file is empty."
        }), 400

    if len(image_bytes) > MAX_IMAGE_SIZE:
        return jsonify({
            "error": "Image is too large. Maximum size is 5 MB."
        }), 413

    try:
        # Verify that the file is a real, readable image.
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.verify()

        # Reopen after verify() to read image properties.
        with Image.open(io.BytesIO(image_bytes)) as image:
            detected_format = image.format
            image_width, image_height = image.size
            image_mode = image.mode

        if detected_format not in MIME_TYPES:
            return jsonify({
                "error": "Please upload a valid PNG, JPG or WEBP image."
            }), 400

        mime_type = MIME_TYPES[detected_format]

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ):
        return jsonify({
            "error": "The uploaded file is not a valid supported image."
        }), 400

    # ------------------------------------------------------
    # C. Analyze the image using Gemini
    # ------------------------------------------------------

    try:
        result = analyze_with_gemini(
            image_bytes,
            mime_type,
        )

        # Deterministic image metadata: measured from the file,
        # not guessed by the AI model.
        result["image_metadata"] = {
            "width": image_width,
            "height": image_height,
            "size_bytes": len(image_bytes),
            "size_kb": round(len(image_bytes) / 1024, 2),
            "format": detected_format,
            "color_mode": image_mode,
        }

        # Save the completed audit while preserving the existing response.
        result["audit_id"] = save_audit(
            uploaded_file.filename,
            report_name,
            result,
            image_bytes,
        )
        result["report_name"] = report_name

        return jsonify(result), 200

    except Exception as error:
        # Log diagnostic details in the backend terminal.
        # Never print the API key.
        print(
            f"Gemini analysis failed: "
            f"{type(error).__name__}: {error}"
        )

        if not os.getenv("GEMINI_API_KEY", "").strip():
            return jsonify({
                "error": (
                    "Gemini API key is missing. "
                    "Check backend/.env and restart Flask."
                )
            }), 503

        return jsonify({
            "error": (
                "Gemini analysis failed. Check the backend terminal "
                "for details about the model, API key, quota or network."
            )
        }), 502




# ==========================================================
# 9. PERSISTENT AUDIT HISTORY API
# ==========================================================

@app.get("/api/audits")
def list_audits():
    """Return saved audit summaries, newest first."""
    connection = get_db_connection()
    try:
        rows = connection.execute(
            """
            SELECT id, created_at, filename, report_name, score, summary,
                   findings_json, image_metadata_json
            FROM audits
            ORDER BY id DESC
            """
        ).fetchall()

        audits = []
        for row in rows:
            audits.append({
                "id": row["id"],
                "created_at": row["created_at"],
                "filename": row["filename"],
                "report_name": row["report_name"],
                "score": row["score"],
                "summary": row["summary"],
                "findings": json.loads(row["findings_json"] or "[]"),
                "image_metadata": json.loads(
                    row["image_metadata_json"] or "{}"
                ),
            })

        return jsonify({"audits": audits}), 200
    except (sqlite3.Error, json.JSONDecodeError) as error:
        print(f"Could not load audit history: {type(error).__name__}: {error}")
        return jsonify({"error": "Could not load audit history."}), 500
    finally:
        connection.close()


@app.get("/api/audits/<int:audit_id>")
def get_audit(audit_id):
    """Return one saved audit, including its original screenshot."""
    connection = get_db_connection()
    try:
        row = connection.execute(
            """
            SELECT id, created_at, filename, report_name, score, summary,
                   findings_json, image_metadata_json, image_data
            FROM audits
            WHERE id = ?
            """,
            (audit_id,),
        ).fetchone()

        if row is None:
            return jsonify({"error": "Audit not found."}), 404

        image_data_url = None
        if row["image_data"]:
            image_base64 = base64.b64encode(row["image_data"]).decode("ascii")
            image_format = json.loads(
                row["image_metadata_json"] or "{}"
            ).get("format", "PNG").upper()
            mime_type = MIME_TYPES.get(image_format, "image/png")
            image_data_url = f"data:{mime_type};base64,{image_base64}"

        return jsonify({
            "id": row["id"],
            "created_at": row["created_at"],
            "filename": row["filename"],
            "report_name": row["report_name"],
            "score": row["score"],
            "summary": row["summary"],
            "findings": json.loads(row["findings_json"] or "[]"),
            "image_metadata": json.loads(
                row["image_metadata_json"] or "{}"
            ),
            "image_data_url": image_data_url,
        }), 200
    except (sqlite3.Error, json.JSONDecodeError) as error:
        print(f"Could not load audit {audit_id}: {type(error).__name__}: {error}")
        return jsonify({"error": "Could not load this audit."}), 500
    finally:
        connection.close()


@app.patch("/api/audits/<int:audit_id>/name")
def rename_audit(audit_id):
    """Update the persistent display name of a saved audit."""
    payload = request.get_json(silent=True) or {}
    report_name = payload.get("report_name", "")
    if not isinstance(report_name, str) or not report_name.strip():
        return jsonify({"error": "Report name cannot be empty."}), 400
    report_name = report_name.strip()
    if len(report_name) > 90:
        return jsonify({"error": "Report names must be 90 characters or fewer."}), 400
    connection = get_db_connection()
    try:
        cursor = connection.execute(
            "UPDATE audits SET report_name = ? WHERE id = ?",
            (report_name, audit_id),
        )
        connection.commit()
        if cursor.rowcount == 0:
            return jsonify({"error": "Audit not found."}), 404
        return jsonify({"id": audit_id, "report_name": report_name}), 200
    except sqlite3.Error as error:
        print(f"Could not rename audit {audit_id}: {type(error).__name__}: {error}")
        return jsonify({"error": "Could not rename this report."}), 500
    finally:
        connection.close()


# ==========================================================
# 10. UPLOAD SIZE ERROR HANDLER
# ==========================================================

@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({
        "error": "Image is too large. Maximum upload size is 5 MB."
    }), 413


# ==========================================================
# 11. GENERAL API ERROR HANDLER
# ==========================================================

@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return jsonify({
            "error": "API endpoint not found."
        }), 404

    return "Page not found.", 404


# ==========================================================
# 12. START THE FLASK SERVER
# ==========================================================

# Initialize the audit history database
init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
