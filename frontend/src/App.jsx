
import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [image, setImage] = useState(null);
  const [reportName, setReportName] = useState("");
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
  if (!loading) return;

  setProgress(0);

  const timer = setInterval(() => {
    setProgress((current) => {
      if (current >= 90) return 90;
      return Math.min(90, current + 1);
    });
  }, 500);

  return () => clearInterval(timer);
}, [loading]);
  const [error, setError] = useState("");
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [activeView, setActiveView] = useState("overview");
  const [auditHistory, setAuditHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [openingAuditId, setOpeningAuditId] = useState(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Please upload a PNG, JPG, or WEBP image.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Your image must be smaller than 5 MB.");
      event.target.value = "";
      return;
    }

    setImage(file);
    setReportName("");
    setPreview(URL.createObjectURL(file));
    setResults(null);
    setSelectedFinding(null);
    setError("");
  }

  function removeImage() {
    setImage(null);
    setReportName("");
    setPreview("");
    setResults(null);
    setSelectedFinding(null);
    setError("");

    const input = document.getElementById("image-upload");
    if (input) input.value = "";
  }

  async function analyzeDesign() {
    if (!image) {
      setError("Upload a screenshot before starting the analysis.");
      return;
    }
    if (!reportName.trim()) {
      setError("Give this audit a name before starting the analysis.");
      return;
    }
    if (reportName.trim().length > 90) {
      setError("Audit names must be 90 characters or fewer.");
      return;
    }

    setLoading(true);
    setError("");
    setResults(null);
    setSelectedFinding(null);

    try {
      const formData = new FormData();
      formData.append("image", image);
      formData.append("report_name", reportName.trim());

      const response = await fetch(
        "http://127.0.0.1:5000/api/analyze",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed.");
      }

      setResults({ ...data, report_name: data.report_name || reportName.trim() });
      setProgress(100);

      // Keep the screenshot clear until the user selects a finding.
      setSelectedFinding(null);
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Cannot connect to DesignLens. Make sure the Flask backend is running."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadAuditHistory() {
    setHistoryLoading(true);
    setHistoryError("");

    try {
      const response = await fetch("http://127.0.0.1:5000/api/audits");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load audit history.");
      }

      setAuditHistory(Array.isArray(data.audits) ? data.audits : []);
    } catch (err) {
      setHistoryError(
        err.message === "Failed to fetch"
          ? "Cannot connect to DesignLens. Make sure the Flask backend is running."
          : err.message
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function showAuditHistory(event) {
    event?.preventDefault();
    setActiveView("reports");
    await loadAuditHistory();
    window.setTimeout(() => {
      document.getElementById("audit-history")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  async function openSavedAudit(auditId) {
    setOpeningAuditId(auditId);
    setHistoryError("");

    try {
      const response = await fetch(
        `http://127.0.0.1:5000/api/audits/${auditId}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not open this audit.");
      }

      setResults({
        audit_id: data.id,
        report_name: data.report_name,
        score: data.score,
        summary: data.summary,
        findings: data.findings || [],
        image_metadata: data.image_metadata || {},
        analysis_mode: "saved_audit",
      });
      setPreview(data.image_data_url || "");
      setImage(null);
      setSelectedFinding(null);
      setActiveView("overview");

      window.setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 0);
    } catch (err) {
      setHistoryError(
        err.message === "Failed to fetch"
          ? "Cannot connect to DesignLens. Make sure the Flask backend is running."
          : err.message
      );
    } finally {
      setOpeningAuditId(null);
    }
  }

  async function renameAudit(audit) {
    const currentName = audit.report_name || makeDefaultAuditName(audit);
    const nextName = window.prompt("Name this audit report", currentName);
    if (nextName === null) return;
    const reportName = nextName.trim();
    if (!reportName) {
      setHistoryError("Please enter a report name.");
      return;
    }
    if (reportName.length > 90) {
      setHistoryError("Report names must be 90 characters or fewer.");
      return;
    }
    setHistoryError("");
    try {
      const response = await fetch(`http://127.0.0.1:5000/api/audits/${audit.id}/name`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_name: reportName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not rename this report.");
      setAuditHistory((items) => items.map((item) => item.id === audit.id ? { ...item, report_name: data.report_name } : item));
    } catch (err) {
      setHistoryError(err.message === "Failed to fetch" ? "Cannot connect to DesignLens. Make sure the Flask backend is running." : err.message);
    }
  }

  function makeDefaultAuditName(audit) {
    const original = (audit.filename || "").split(/[\\/]/).pop() || "";
    const stem = original.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    return stem ? `UI Audit — ${stem}` : `Design Audit #${String(audit.id).padStart(3, "0")}`;
  }

  function formatAuditDate(value) {
    if (!value) return "Date unavailable";
    const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function isValidBox(box) {
    if (!box || typeof box !== "object") return false;

    const { x, y, width, height } = box;
    const values = [x, y, width, height];

    return (
      values.every(
        (value) =>
          typeof value === "number" && Number.isFinite(value)
      ) &&
      x >= 0 &&
      y >= 0 &&
      width > 0 &&
      height > 0 &&
      x + width <= 1000 &&
      y + height <= 1000
    );
  }

  function formatBytes(bytes) {
    if (typeof bytes !== "number") return "Unavailable";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  async function downloadPdfReport() {
    if (!results) return;

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
      const maroon = [86, 11, 24];
      const burgundy = [117, 22, 45];
      const champagne = [242, 229, 198];
      const ink = [49, 43, 43];
      const muted = [125, 108, 105];
      const pale = [250, 247, 241];
      const reportFindings = Array.isArray(results.findings) ? results.findings : [];
      const relevantAccessibilityFindings = reportFindings.filter((finding) =>
        ["accessibility", "color", "typography"].includes(
          String(finding.category || "").trim().toLowerCase()
        )
      );
      const accessibilityPenalty = relevantAccessibilityFindings.reduce((total, finding) => {
        const severity = String(finding.severity || "info").toLowerCase();
        return total + (severity === "high" ? 24 : severity === "medium" ? 15 : severity === "low" ? 7 : 3);
      }, 0);
      const accessibilityScore = relevantAccessibilityFindings.length
        ? Math.max(0, 100 - accessibilityPenalty)
        : 100;
      const accessibilityLabel = relevantAccessibilityFindings.length === 0
        ? "No relevant concerns flagged"
        : accessibilityScore >= 85
          ? "Fewer concerns flagged"
          : accessibilityScore >= 65
            ? "Some concerns to review"
            : "Priority review recommended";
      let y = 18;

      const ensureSpace = (height) => {
        if (y + height > pageHeight - 14) {
          doc.addPage();
          y = 20;
          doc.setFillColor(...maroon);
          doc.rect(0, 0, pageWidth, 2, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7);
          doc.setTextColor(...maroon);
          doc.text("DESIGNLENS  /  DESIGN REVIEW", margin, 12);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(...muted);
          doc.text("CONTINUED", pageWidth - margin, 12, { align: "right" });
        }
      };

      const addParagraph = (value, options = {}) => {
        const { size = 9.5, color = ink, bold = false, lineHeight = 4.5, x = margin, width = contentWidth, gapAfter = 2 } = options;
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(size);
        doc.setTextColor(...color);
        const lines = doc.splitTextToSize(String(value ?? ""), width);
        ensureSpace(lines.length * lineHeight + gapAfter);
        doc.text(lines, x, y);
        y += lines.length * lineHeight + gapAfter;
      };

      const addSectionTitle = (eyebrow, title) => {
        // Reserve enough vertical space for both baselines. jsPDF positions
        // text by its baseline, so a small y increment makes these overlap.
        ensureSpace(21);
        y += 1.5;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...burgundy);
        doc.text(eyebrow.toUpperCase(), margin, y);
        y += 7.5;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(13.5);
        doc.setTextColor(...maroon);
        doc.text(title, margin, y);
        y += 9.0;
      };

      // Minimal branded header: one solid band, restrained typography and no heavy cards.
      doc.setFillColor(...maroon);
      doc.rect(0, 0, pageWidth, 42, "F");
      doc.setFillColor(...champagne);
      doc.rect(margin, 9, 1.4, 24, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...champagne);
      doc.text("DESIGNLENS  /  DESIGN REVIEW", margin + 6, 13);
      const rawPdfReportName = reportName.trim() || results.report_name || "";
      const pdfReportName = !rawPdfReportName || /^(screenshot(?:\\s*\\(\\d+\\))?|\\d{1,3}|untitled|image)$/i.test(rawPdfReportName.trim())
        ? "UI/UX Audit Report"
        : rawPdfReportName.trim();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(17);
      doc.setTextColor(255, 255, 255);
      const pdfTitleLines = doc.splitTextToSize(pdfReportName, pageWidth - margin * 2 - 43).slice(0, 2);
      doc.text(pdfTitleLines, margin + 6, pdfTitleLines.length > 1 ? 20 : 23);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(235, 220, 215);
      doc.text(`GENERATED  ${new Date().toLocaleString()}`, margin + 6, 35);

      const score = Number(results.score);
      const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
      doc.setDrawColor(218, 190, 174);
      doc.setLineWidth(0.4);
      doc.roundedRect(pageWidth - margin - 30, 8, 30, 24, 2, 2, "S");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...champagne);
      doc.setFontSize(16);
      doc.text(safeScore === null ? "—" : String(safeScore), pageWidth - margin - 15, 19, { align: "center" });
      doc.setFontSize(5.8);
      doc.text("DESIGN SCORE", pageWidth - margin - 15, 26, { align: "center" });
      y = 44;

      addSectionTitle("01 / Overview", "Audit summary");
      const summary = String(results.summary || "No summary available.");
      const summaryLines = doc.splitTextToSize(summary, contentWidth - 8);
      ensureSpace(summaryLines.length * 3.8 + 4);
      doc.setFillColor(...burgundy);
      doc.rect(margin, y - 2, 1.1, summaryLines.length * 4.2 + 3, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.1);
      doc.setTextColor(...ink);
      doc.text(summaryLines, margin + 5, y);
      y += summaryLines.length * 4.2 + 6;

      if (metadata) {
        addSectionTitle("02 / Source", "Screenshot details");
        const details = [
          ["Dimensions", `${metadata.width ?? "?"} × ${metadata.height ?? "?"} px`],
          ["Format", String(metadata.format || "Unavailable").toUpperCase()],
          ["File size", formatBytes(metadata.size_bytes)],
        ];
        const gap = 9;
        const cellWidth = (contentWidth - gap * 2) / 3;
        details.forEach((item, index) => {
          const x = margin + index * (cellWidth + gap);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(...muted);
          doc.text(item[0].toUpperCase(), x, y);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(...maroon);
          doc.text(doc.splitTextToSize(item[1], cellWidth), x, y + 5);
        });
        y += 13;
      }

      // WCAG review meter included in the downloadable report.
      addSectionTitle(metadata ? "03 / Accessibility" : "02 / Accessibility", "WCAG review meter");
      ensureSpace(25);
      if (accessibilityScore === null) {
        addParagraph("More evidence needed", { size: 9.5, color: maroon, bold: true, gapAfter: 1 });
        addParagraph("No accessibility, colour or typography findings were flagged. The 100/100 value means none were flagged by this AI pass; it does not mean the design is WCAG-compliant.", {
          size: 8.2, color: muted, lineHeight: 3.8, gapAfter: 2,
        });
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(...maroon);
        doc.text(String(accessibilityScore), margin, y + 1);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...muted);
        doc.text("/ 100  ·  AI-assisted review signal", margin + 12, y + 1);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.3);
        doc.setTextColor(...burgundy);
        doc.text(accessibilityLabel, pageWidth - margin, y + 1, { align: "right" });
        const barX = margin;
        const barY = y + 5;
        const barWidth = contentWidth;
        doc.setFillColor(232, 222, 208);
        doc.roundedRect(barX, barY, barWidth, 3, 1.5, 1.5, "F");
        doc.setFillColor(...burgundy);
        doc.roundedRect(barX, barY, Math.max(1, barWidth * accessibilityScore / 100), 3, 1.5, 1.5, "F");
        // Leave clear space below the meter bar before its explanatory note.
        y += 15;
        addParagraph(`${relevantAccessibilityFindings.length} relevant finding(s) considered. This is a heuristic based on AI-flagged findings, not an official WCAG score or certification. Verify contrast ratios, keyboard access, semantics and screen-reader behaviour separately.`, {
          size: 7.1, color: muted, lineHeight: 3.5, gapAfter: 3,
        });
      }

      addSectionTitle(metadata ? "04 / Findings" : "03 / Findings", `Recommended improvements (${reportFindings.length})`);
      if (!reportFindings.length) {
        addParagraph("No findings were returned for this audit.", { color: muted });
      }

      reportFindings.forEach((finding, index) => {
        const title = String(finding.title || "Finding");
        const description = String(finding.description || "No description available.");
        const impact = finding.impact ? String(finding.impact) : "";
        const recommendation = finding.recommendation ? String(finding.recommendation) : "";
        const textX = margin + 8;
        const textWidth = contentWidth - 8;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.6);
        const titleLines = doc.splitTextToSize(title, textWidth);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.8);
        const descriptionLines = doc.splitTextToSize(description, textWidth);
        const impactLines = impact ? doc.splitTextToSize(impact, textWidth) : [];
        const recommendationLines = recommendation ? doc.splitTextToSize(recommendation, textWidth) : [];
        const metaText = [finding.category, finding.severity]
          .filter(Boolean)
          .map((value) => String(value))
          .join("  ·  ");
        const hasMeta = Boolean(metaText);

        // Estimate the complete finding before drawing it, so a finding starts
        // on a fresh page rather than being cut off at the page boundary.
        // Measure the actual lines drawn below. Keep a small safety margin,
        // but avoid the old oversized estimate that stranded short findings
        // on a nearly empty continuation page.
        const estimatedHeight =
          3.5 +
          titleLines.length * 4.5 +
          (hasMeta ? 4.5 : 0) +
          descriptionLines.length * 3.8 + 1.5 +
          (impactLines.length ? 3.6 + impactLines.length * 3.8 + 1.5 : 0) +
          (recommendationLines.length ? 3.6 + recommendationLines.length * 3.8 : 0) +
          3;
        ensureSpace(estimatedHeight + 1.5);

        // A simple numbered rail and thin divider keep the report minimal.
        y += 1.5;
        const top = y;
        let textY = top + 3.5;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...burgundy);
        doc.text(String(index + 1).padStart(2, "0"), margin, textY);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.6);
        doc.setTextColor(...maroon);
        doc.text(titleLines, textX, textY);
        textY += titleLines.length * 4.5 + 2;

        if (hasMeta) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.7);
          doc.setTextColor(...muted);
          doc.text(metaText, textX, textY);
          textY += 4.5;
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.8);
        doc.setTextColor(...ink);
        doc.text(descriptionLines, textX, textY);
        textY += descriptionLines.length * 3.8 + 1.5;

        if (impactLines.length) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(...burgundy);
          doc.text("Potential impact", textX, textY);
          textY += 3.6;

          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.6);
          doc.setTextColor(...ink);
          doc.text(impactLines, textX, textY);
          textY += impactLines.length * 3.8 + 1.5;
        }

        if (recommendationLines.length) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(...burgundy);
          doc.text("Recommendation", textX, textY);
          textY += 3.6;

          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.6);
          doc.setTextColor(...ink);
          doc.text(recommendationLines, textX, textY);
          textY += recommendationLines.length * 3.8;
        }

        // Continue from the actual last line drawn. Do not pad to the
        // conservative estimate: that was creating large blank gaps and
        // pushing short findings onto an otherwise mostly empty new page.
        y = textY + 3.5;
        if (index < reportFindings.length - 1) {
          doc.setDrawColor(229, 220, 216);
          doc.setLineWidth(0.25);
          doc.line(margin, y, pageWidth - margin, y);
          y += 5.5;
        }
      });
      ensureSpace(10);
      y += 1;
      addParagraph("DesignLens provides an AI-assisted screenshot review, not a complete accessibility audit or certification. Validate important findings with manual testing and assistive technologies.", {
        size: 7, color: muted, lineHeight: 3.3, gapAfter: 1,
      });

      const totalPages = doc.internal.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(229, 220, 216);
        doc.setLineWidth(0.25);
        doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...maroon);
        doc.text("DESIGNLENS", margin, pageHeight - 7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...muted);
        doc.text(`PAGE ${page} OF ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: "right" });
      }

      const safeFileName = (results.report_name || reportName.trim() || "DesignLens Audit Report")
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 80) || "DesignLens-Audit-Report";
      doc.save(`${safeFileName}.pdf`);
    } catch (err) {
      setError(`Could not generate the PDF report: ${err.message}`);
    }
  }

  const findings = results?.findings || [];
  const metadata = results?.image_metadata;
  // A screenshot-only, AI-derived accessibility signal — not a WCAG conformance score.
  const wcagRelevantFindings = findings.filter((finding) =>
    ["accessibility", "color", "typography"].includes(
      String(finding.category || "").trim().toLowerCase()
    )
  );
  const wcagPenalty = wcagRelevantFindings.reduce((total, finding) => {
    const severity = String(finding.severity || "info").toLowerCase();
    const penalty = severity === "high" ? 24 : severity === "medium" ? 15 : severity === "low" ? 7 : 3;
    return total + penalty;
  }, 0);
  const wcagMeterScore = wcagRelevantFindings.length
    ? Math.max(0, 100 - wcagPenalty)
    : 100;
  const wcagMeterLabel = wcagRelevantFindings.length === 0
    ? "No relevant concerns flagged"
    : wcagMeterScore >= 85
      ? "Fewer concerns flagged"
      : wcagMeterScore >= 65
        ? "Some concerns to review"
        : "Priority review recommended";
  const selectedFindingData = findings.find(
    (finding) => finding.id === selectedFinding
  );

  return (
    <div className="app-shell">
      <style>{`@media (max-width: 900px) { .audit-evidence-layout { grid-template-columns: minmax(0, 1fr) !important; } .audit-evidence-layout > div:first-child { position: static !important; } }`}</style>
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-icon">D</span>
          <span>
            design<span className="brand-light">lens</span>
          </span>
        </a>

        <div className="side-label">WORKSPACE</div>
        <a
          className={`nav-item ${activeView === "overview" ? "active" : ""}`}
          href="#overview"
          onClick={() => setActiveView("overview")}
        >
          ◫ &nbsp; Overview
        </a>
        <a
          className={`nav-item ${activeView === "analyzer" ? "active" : ""}`}
          href="#analyzer"
          onClick={() => {
            setActiveView("analyzer");
            document.getElementById("analyzer")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }}
        >
          ◎ &nbsp; UI Analyzer
        </a>
        <a
          className={`nav-item ${activeView === "reports" ? "active" : ""}`}
          href="#audit-history"
          onClick={showAuditHistory}
        >
          ▤ &nbsp; Audit Reports
        </a>

        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon">✳</span>
            <strong>Design better.</strong>
            <p>
              Make every pixel more accessible and user-friendly.
            </p>
          </div>

          <div className="profile">
            <div className="avatar">DL</div>
            <div>
              <strong>DesignLens</strong>
              <small>Design workspace</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> {activeView === "reports" ? "Audit Reports" : activeView === "analyzer" ? "UI Analyzer" : "Overview"}
          </div>
          <div className="status">
            <span /> SYSTEM READY
          </div>
        </header>

        {activeView !== "reports" && (
          <>
        <section className="welcome">
          <div>
            <div className="eyebrow">
              YOUR DESIGN INTELLIGENCE TOOL
            </div>
            <h1>
              See your design
              <br />
              through a <em>better lens.</em>
            </h1>
            <p className="intro">
              Evaluate interfaces, uncover accessibility concerns, and
              discover opportunities to create better digital experiences.
            </p>
          </div>

          <div className="hero-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-core">
              <span>◉</span>
            </div>
            <div className="art-tag">UX + AI</div>
            <div className="art-dot dot-one" />
            <div className="art-dot dot-two" />
          </div>
        </section>

        <section className="stats-grid">
          <article className="stat-card">
            <span className="stat-icon purple">◈</span>
            <div className="stat-label">ANALYSIS ENGINE</div>
            <div className="stat-value">AI-powered</div>
            <p>Visual design evaluation</p>
          </article>

          <article className="stat-card">
            <span className="stat-icon green">◎</span>
            <div className="stat-label">ACCESSIBILITY</div>
            <div className="stat-value">WCAG-inspired</div>
            <p>Potential accessibility concerns</p>
          </article>

          <article className="stat-card">
            <span className="stat-icon orange">↗</span>
            <div className="stat-label">YOUR NEXT STEP</div>
            <div className="stat-value">Improve</div>
            <p>Actionable design feedback</p>
          </article>
        </section>

        <section className="analyzer-section" id="analyzer">
          <div className="section-heading">
            <div>
              <div className="eyebrow">START A NEW AUDIT</div>
              <h2>Analyze your interface</h2>
              <p>Upload a screenshot to begin your design review.</p>
            </div>
            <span className="step-pill">01 / UPLOAD</span>
          </div>

          <div className="analyzer-grid">
            <div className="upload-card">
              <label className="upload-zone" htmlFor="image-upload">
                {preview ? (
                  <img
                    className="preview-image"
                    src={preview}
                    alt="Uploaded interface preview"
                  />
                ) : (
                  <>
                    <span className="upload-icon">↑</span>
                    <strong>Drop your design into focus</strong>
                    <span className="upload-description">
                      Choose a screenshot from your device
                    </span>
                    <span className="browse-button">Browse files</span>
                    <span className="file-hint">
                      PNG, JPG or WEBP · Max 5 MB
                    </span>
                  </>
                )}
              </label>

              <input
                id="image-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleUpload}
                hidden
              />

              {image && (
                <div className="file-row">
                  <span className="file-symbol">▧</span>
                  <div className="file-details">
                    <strong>{image.name}</strong>
                    <small>
                      {formatBytes(image.size)} · Ready for analysis
                    </small>
                  </div>
                  <button
                    type="button"
                    className="remove-button"
                    onClick={removeImage}
                    aria-label="Remove uploaded image"
                  >
                    ×
                  </button>
                </div>
              )}

              {image && (
                <div className="report-name-field">
                  <label htmlFor="report-name">Name this audit report <span>*</span></label>
                  <input
                    id="report-name"
                    type="text"
                    value={reportName}
                    onChange={(event) => setReportName(event.target.value)}
                    placeholder="e.g. Portfolio homepage — first review"
                    maxLength={90}
                    required
                    aria-describedby="report-name-hint"
                  />
                  <small id="report-name-hint">This name will appear in Audit Reports and on your downloaded PDF. You can rename it later.</small>
                </div>
              )}

              {error && (
                <div className="error-message" role="alert">
                  {error}
                </div>
              )}

              <button
                type="button"
                className="analyze-button"
                onClick={analyzeDesign}
                disabled={!image || !reportName.trim() || reportName.trim().length > 90 || loading}
              >
                {loading
                  ? "Analyzing your design..."
                  : "✳  Analyze my design  →"}
              </button>

              
              
            {loading && (
              <div
                className="analysis-progress"
                role="status"
                aria-label={`Estimated analysis progress: ${progress}%`}
              >
                <div className="analysis-progress-header">
                  <span className="analysis-progress-dot" />
                  <span>Analyzing your design</span>
                  <strong>{progress}%</strong>
                </div>
            
                <div
                  className="analysis-progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <div
                    className="analysis-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
            
                <div className="analysis-progress-footer">
                  <span>{progress}% completed</span>
                  <span>{100 - progress}% remaining</span>
                </div>
              </div>
            )}





              <p className="privacy-note">
                Your screenshot is sent to the analysis backend only when
                you start an audit.
              </p>
            </div>

            <div className="criteria-card">
              <div className="criteria-title">WHAT WE EVALUATE</div>

              <div className="criterion">
                <span className="criterion-icon purple">◈</span>
                <div>
                  <strong>Visual hierarchy</strong>
                  <p>Layout, alignment and visual balance</p>
                </div>
              </div>

              <div className="criterion">
                <span className="criterion-icon blue">Aa</span>
                <div>
                  <strong>Typography & readability</strong>
                  <p>Text clarity and legibility</p>
                </div>
              </div>

              <div className="criterion">
                <span className="criterion-icon green">◉</span>
                <div>
                  <strong>Accessibility</strong>
                  <p>Potential contrast and readability concerns</p>
                </div>
              </div>

              <div className="criterion">
                <span className="criterion-icon orange">✳</span>
                <div>
                  <strong>Design consistency</strong>
                  <p>Spacing, components and visual patterns</p>
                </div>
              </div>

              <div className="criteria-footer">
                <span>✦</span> AI-assisted insights + measurable checks
              </div>
            </div>
          </div>
        </section>
          </>
        )}

        {activeView === "reports" && (
          <section
            className="results-section audit-history-page"
            id="audit-history"
            style={{ scrollMarginTop: "24px" }}
          >
            <div className="section-heading">
              <div>
                <div className="eyebrow">YOUR SAVED WORK</div>
                <h2>Audit library</h2>
                <p>Your saved design reviews, organized by name, score, and date.</p>
              </div>
              <button
                type="button"
                className="analyze-button"
                onClick={loadAuditHistory}
                disabled={historyLoading}
                style={{ width: "auto", marginTop: 0, padding: "12px 18px" }}
              >
                {historyLoading ? "Refreshing..." : "Refresh history"}
              </button>
            </div>

            <div className="audit-history-overview">
              <div className="audit-history-stat"><span>Saved reports</span><strong>{auditHistory.length}</strong></div>
              <div className="audit-history-stat"><span>Latest report</span><strong>{auditHistory.length ? formatAuditDate(auditHistory[0].created_at) : "—"}</strong></div>
              <div className="audit-history-stat"><span>Workspace</span><strong>Design reviews</strong></div>
            </div>

            {historyError && (
              <div className="error-message" role="alert">{historyError}</div>
            )}

            {historyLoading && auditHistory.length === 0 && (
              <div className="results-summary">
                <h3>Loading saved reports…</h3>
                <p>DesignLens is retrieving your audit history.</p>
              </div>
            )}

            {!historyLoading && !historyError && auditHistory.length === 0 && (
              <div className="results-summary">
                <h3>No saved audits yet</h3>
                <p>Analyze a screenshot first. Successful audits will appear here automatically.</p>
                <button
                  type="button"
                  className="analyze-button"
                  onClick={() => {
                    setActiveView("analyzer");
                    document.getElementById("analyzer")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                  style={{ maxWidth: "240px" }}
                >
                  Start your first audit →
                </button>
              </div>
            )}

            <div className="audit-history-grid">
              {auditHistory.map((audit) => (
                <article className="audit-history-card" key={audit.id}>
                  <div className="audit-history-card-top">
                    <span className="audit-history-index">AUDIT {String(audit.id).padStart(3, "0")}</span>
                    <span className="audit-history-score">{audit.score ?? "—"}<small>/100</small></span>
                  </div>
                  <div className="audit-history-card-body">
                    <h3>{audit.report_name || makeDefaultAuditName(audit)}</h3>
                    <p className="audit-history-original">Source file: {audit.filename || "Screenshot not named"}</p>
                    <p className="audit-history-summary">{audit.summary || "No summary available."}</p>
                    <div className="audit-history-meta">
                      <span><b>Saved</b>{formatAuditDate(audit.created_at)}</span>
                      <span><b>Findings</b>{(audit.findings || []).length}</span>
                    </div>
                  </div>
                  <div className="audit-history-card-actions">
                    <button type="button" className="audit-rename-button" onClick={() => renameAudit(audit)}>Rename</button>
                    <button type="button" className="browse-button" onClick={() => openSavedAudit(audit.id)} disabled={openingAuditId === audit.id}>
                      {openingAuditId === audit.id ? "Opening…" : "Open report →"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {results && activeView !== "reports" && (
          <section className="results-section" id="results">
            <div className="section-heading">
              <div>
                <div className="eyebrow">YOUR AUDIT RESULTS</div>
                <h2>Design review</h2>
                <p>Explore the evidence behind your findings.</p>
              </div>

              <span className="score-badge">
                {results.score ?? "—"} / 100
              </span>
            </div>

            <div className="results-summary">
              <h3>{results.summary || "Analysis complete"}</h3>
              <p>
                Use these findings as guidance. Screenshot-based analysis
                cannot establish full website accessibility.
              </p>
            </div>

            <section className="wcag-meter-card" aria-labelledby="wcag-meter-title">
              <div className="wcag-meter-copy">
                <div className="eyebrow">ACCESSIBILITY SNAPSHOT</div>
                <h3 id="wcag-meter-title">WCAG review meter</h3>
                <p>AI-assisted signals from accessibility, colour and typography findings.</p>
                <div className="wcag-meter-status">{wcagMeterLabel}</div>
              </div>
              <div className="wcag-meter-visual">
                <div className={`wcag-meter-value ${wcagMeterScore !== null && wcagMeterScore < 65 ? "is-low" : ""}`}>
                  {wcagMeterScore === null ? "—" : wcagMeterScore}
                  <span>{wcagMeterScore === null ? " / 100" : "/100"}</span>
                </div>
                <div
                  className="wcag-meter-track"
                  role="meter"
                  aria-label="AI-estimated accessibility review signal"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={wcagMeterScore === null ? undefined : wcagMeterScore}
                  aria-valuetext={wcagMeterScore === null ? "More evidence needed" : `${wcagMeterScore} out of 100; AI-estimated review signal`}
                >
                  <div className="wcag-meter-fill" style={{ width: `${wcagMeterScore ?? 0}%` }} />
                </div>
                <div className="wcag-meter-scale"><span>Review needed</span><span>Fewer flags</span></div>
              </div>
              <p className="wcag-meter-disclaimer">
                This is a heuristic based on AI-flagged findings, not an official WCAG score or certification. If no relevant findings are flagged, the meter displays 100 to indicate no issues were flagged in this AI pass—not verified compliance. Verify contrast ratios, keyboard access, semantics and screen-reader behaviour separately.
              </p>
            </section>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
              <button
                type="button"
                className="analyze-button"
                onClick={downloadPdfReport}
                style={{ width: "auto", marginTop: 0, padding: "12px 18px" }}
              >
                Download PDF report ↓
              </button>
            </div>

            {metadata && (
              <div
                className="stats-grid"
                style={{ marginTop: "20px" }}
              >
                <article className="stat-card">
                  <div className="stat-label">IMAGE DIMENSIONS</div>
                  <div className="stat-value">
                    {metadata.width} × {metadata.height}
                  </div>
                  <p>Width × height in pixels</p>
                </article>

                <article className="stat-card">
                  <div className="stat-label">FILE SIZE</div>
                  <div className="stat-value">
                    {formatBytes(metadata.size_bytes)}
                  </div>
                  <p>Measured from the uploaded file</p>
                </article>

                <article className="stat-card">
                  <div className="stat-label">IMAGE FORMAT</div>
                  <div className="stat-value">
                    {metadata.format || "Unavailable"}
                  </div>
                  <p>
                    Color mode: {metadata.color_mode || "Unavailable"}
                  </p>
                </article>
              </div>
            )}

            <div
              className="audit-evidence-layout"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
                gap: "28px",
                alignItems: "start",
                marginTop: "30px",
                width: "100%",
                maxWidth: "none",
              }}
            >
              <div style={{ minWidth: 0, position: "sticky", top: "18px" }}>
              <div className="section-heading">
                <div>
                  <div className="eyebrow">VISUAL EVIDENCE</div>
                  <h2>Explore the screenshot</h2>
                  <p>
                    Select a finding below to show only its estimated location.
                  </p>
                </div>
              </div>

              <div
                style={{
                  border: "1px solid #e4e0f0",
                  borderRadius: "16px",
                  padding: "20px",
                  background: "#ffffff",
                  marginTop: "16px",
                }}
              >
                {preview && (
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      lineHeight: 0,
                      overflow: "hidden",
                      borderRadius: "8px",
                    }}
                  >
                    <img
                      src={preview}
                      alt="Screenshot with estimated UX issue locations"
                      style={{
                        display: "block",
                        width: "100%",
                        height: "auto",
                      }}
                    />

                    {findings.map((finding, index) => {
                      const box = finding.bounding_box;
                      const isSelected = selectedFinding === finding.id;

                      // Show only the selected finding's highlight.
                      if (!isSelected || !isValidBox(box)) return null;

                      return (
                        <button
                          key={finding.id ?? index}
                          type="button"
                          title={`Select finding: ${finding.title}`}
                          aria-label={`Highlight finding ${index + 1}: ${finding.title}`}
                          onClick={() =>
                            setSelectedFinding((current) =>
                              current === finding.id ? null : finding.id
                            )
                          }
                          style={{
                            position: "absolute",
                            left: `${box.x / 10}%`,
                            top: `${box.y / 10}%`,
                            width: `${box.width / 10}%`,
                            height: `${box.height / 10}%`,
                            boxSizing: "border-box",
                            padding: 0,
                            border: "3px solid #7c3aed",
                            background: "rgba(124, 58, 237, 0.22)",
                            cursor: "pointer",
                            outline: "none",
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              left: "-2px",
                              top: "-25px",
                              display: "block",
                              padding: "4px 7px",
                              borderRadius: "5px",
                              background: "#7c3aed",
                              color: "#ffffff",
                              fontSize: "12px",
                              fontWeight: 700,
                              lineHeight: 1.2,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {index + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <p
                  style={{
                    fontSize: "12px",
                    lineHeight: 1.6,
                    color: "#77718b",
                    marginTop: "14px",
                  }}
                >
                  Highlighted regions are approximate AI-generated
                  locations, not pixel-perfect measurements. Findings
                  without coordinates cannot be highlighted.
                </p>
              </div>
            </div>

              <div style={{ minWidth: 0 }}>
              <div className="section-heading">
                <div>
                  <div className="eyebrow">DETAILED FINDINGS</div>
                  <h2>Recommended improvements</h2>
                  <p>
                    Click a finding to show or hide its highlight in the screenshot above.
                  </p>
                </div>
              </div>

              <div className="findings-list">
                {findings.map((finding, index) => {
                  const hasBox = isValidBox(finding.bounding_box);
                  const isSelected =
                    selectedFinding === finding.id;

                  return (
                    <article
                      className="finding-card"
                      key={finding.id ?? index}
                      style={{
                        cursor: hasBox ? "pointer" : "default",
                        outline: isSelected
                          ? "2px solid #8b5cf6"
                          : "none",
                        outlineOffset: isSelected ? "2px" : "0",
                      }}
                      onClick={() => {
                        if (hasBox) {
                          setSelectedFinding((current) =>
                            current === finding.id ? null : finding.id
                          );
                        }
                      }}
                    >
                      <div className="finding-number">
                        {String(index + 1).padStart(2, "0")}
                      </div>

                      <div className="finding-content">
                        <strong>{finding.title}</strong>

                        {finding.category && (
                          <p>
                            <b>Category:</b> {finding.category}
                          </p>
                        )}

                        <p>{finding.description}</p>

                        {finding.impact && (
                          <p>
                            <b>Potential impact:</b> {finding.impact}
                          </p>
                        )}

                        {finding.recommendation && (
                          <p>
                            <b>Recommendation:</b>{" "}
                            {finding.recommendation}
                          </p>
                        )}

                        <p
                          style={{
                            fontSize: "12px",
                            color: hasBox ? "#6d28d9" : "#77718b",
                          }}
                        >
                          {hasBox
                            ? isSelected
                              ? "Highlighted in screenshot"
                              : "Click to highlight in screenshot"
                            : "No specific screenshot region returned"}
                        </p>
                      </div>

                      <span className="severity">
                        {finding.severity || "Review"}
                      </span>
                    </article>
                  );
                })}
              </div>

              {findings.length === 0 && (
                <div className="results-summary">
                  <h3>No findings were returned.</h3>
                  <p>
                    Try another screenshot or review the backend response.
                  </p>
                </div>
              )}

              {selectedFindingData && (
                <div
                  className="results-summary"
                  style={{ marginTop: "20px" }}
                >
                  <h3>Selected: {selectedFindingData.title}</h3>
                  <p>
                    {selectedFindingData.recommendation ||
                      selectedFindingData.description}
                  </p>
                </div>
              )}
              </div>
            </div>
          </section>
        )}

        <footer className="footer">
          <span>DESIGNLENS © 2026</span>
          <span>
            Thoughtful design. More accessible experiences.
          </span>
        </footer>
      </main>
    </div>
  );
}

export default App;