// Indian-numbering money/percentage formatters shared across pages. Before this file existed,
// each page/section carried its own copy of these — not quite identical, so this exposes the two
// axes they actually differed on as options rather than silently picking one behavior for everyone:
//   nullDash — true: a null/undefined value renders as "—" (no data). false (default): treated as 0.
//   round    — true (default): sub-lakh amounts round to whole rupees. false: exact amount shown.
const CRORE = 10000000;
const LAKH = 100000;

// Trims to at most 1 decimal without a trailing ".0" (1.50 -> "1.5", 2.00 -> "2").
function trimNum(n) {
    return Number(n.toFixed(1)).toString();
}

export function formatMoney(value, { nullDash = false, round = true } = {}) {
    if (nullDash && (value === null || value === undefined)) {
        return "—";
    }
    const num = Number(value ?? 0);
    const sign = num < 0 ? "-" : "";
    const abs = Math.abs(num);
    if (abs >= CRORE) {
        return `${sign}₹${trimNum(abs / CRORE)} Cr`;
    }
    if (abs >= LAKH) {
        return `${sign}₹${trimNum(abs / LAKH)} L`;
    }
    const whole = round ? Math.round(abs) : abs;
    return `${sign}₹${whole.toLocaleString("en-IN")}`;
}

// Same shape as formatMoney, but always the full, un-abbreviated rupee amount — no "Cr"/"L"
// suffix, ever — per explicit request, for CSV/Excel downloads: a spreadsheet cell should hold the
// real, complete digit count rather than the on-screen abbreviated figure. Always whole rupees
// (matches formatMoney's own round:true default; there's no reason a CSV would want fractional
// paise any more than the on-screen version does).
export function formatMoneyFull(value, { nullDash = false } = {}) {
    if (nullDash && (value === null || value === undefined)) {
        return "—";
    }
    const num = Number(value ?? 0);
    const sign = num < 0 ? "-" : "";
    const whole = Math.round(Math.abs(num));
    return `${sign}₹${whole.toLocaleString("en-IN")}`;
}

// Per explicit request: the ▲/▼ arrow glyph is removed — just the explicit +/− sign in front of the
// number now (e.g. "+12.5%" / "−8.3%").
export function formatDelta(value, { nullDash = false } = {}) {
    if (nullDash && (value === null || value === undefined)) {
        return "—";
    }
    const num = Number(value ?? 0);
    const sign = num >= 0 ? "+" : "−";
    return `${sign}${Math.abs(num).toFixed(1)}%`;
}

// Same growth value/shape as formatDelta now that its own arrow glyph is gone too (kept as its own
// function rather than merged — formatDeltaSigned is specifically for CSV/Excel downloads, where a
// cell's own text is the only "positive vs negative" signal once it's off the page, no color to
// lean on). Always explicitly signed on both sides (unlike a bare Number#toFixed, which omits the
// "+" for a positive value) so the direction is unambiguous.
export function formatDeltaSigned(value, { nullDash = false } = {}) {
    if (nullDash && (value === null || value === undefined)) {
        return "—";
    }
    const num = Number(value ?? 0);
    const sign = num >= 0 ? "+" : "-";
    return `${sign}${Math.abs(num).toFixed(1)}%`;
}
