# DesignLens — AI-Powered UI/UX Audit Platform

DesignLens is an AI-powered UI/UX evaluation tool that analyzes interface screenshots and identifies potential usability, visual design, and accessibility concerns. It generates structured findings and actionable recommendations to help designers improve their interfaces.

## Features

- **AI-powered screenshot analysis** using Google Gemini.
- **Overall audit score and summary** for a quick design review.
- **Structured findings** covering layout, typography, color, navigation, consistency, usability, and accessibility.
- **Visual issue highlighting** using finding-specific screenshot coordinates when available.
- **Audit history** stored in a local SQLite database.
- **Report management** with the ability to rename saved audits.
- **PDF report export** for sharing analysis results.
- **Image validation and metadata extraction** for uploaded screenshots.

## Tech Stack

| Technology | Purpose |
|---|---|
| React and Vite | Frontend |
| JavaScript and CSS | Interface and styling |
| Python and Flask | Backend API |
| Google Gemini API | AI-powered screenshot analysis |
| SQLite | Persistent audit history |
| Pillow | Image validation and metadata |
| jsPDF | PDF report generation |

## How It Works

1. Upload a UI screenshot.
2. The Flask backend validates the image.
3. Google Gemini analyzes the screenshot for potential design issues.
4. DesignLens displays a score, summary, findings, and recommendations.
5. Select findings to inspect their corresponding screenshot regions when available.
6. Save and revisit audits or export a PDF report.

## Project Structure

```text
Design-Lens/
├── backend/
│   ├── App.py
│   ├── App_backend.py
│   ├── requirements.txt
│   └── .env                 # Local only; do not commit
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── .gitignore
└── README.md
```

## Getting Started

### Prerequisites

- Python 3.11 or compatible
- Node.js and npm
- A Google Gemini API key

### 1. Clone the repository

```bash
git clone https://github.com/carolin-20/Design-Lens.git
cd Design-Lens
```

### 2. Install backend dependencies

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create a `backend/.env` file containing your own API credentials:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=your_supported_gemini_model
```

Replace the placeholders with your own working credentials and model configuration. Never commit your actual API key.

Start the backend:

```powershell
python App.py
```

The backend runs at `http://127.0.0.1:5000`.

### 3. Install frontend dependencies

Open a second terminal from the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

### 4. Check the backend

Visit `http://127.0.0.1:5000/api/health` to check the API status.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Check API status |
| POST | `/api/analyze` | Analyze an uploaded screenshot |
| GET | `/api/audits` | List saved audits |
| GET | `/api/audits/<audit_id>` | Retrieve an audit |
| PATCH | `/api/audits/<audit_id>/name` | Rename an audit |

## Limitations

DesignLens is an academic prototype. AI-generated findings and scores are suggestions, not definitive usability measurements or proof of WCAG compliance. Findings should be validated through manual accessibility testing, usability testing, and user research.

## Author

**Carolin Prabu**

A project exploring AI-assisted UI/UX evaluation and accessibility analysis.
