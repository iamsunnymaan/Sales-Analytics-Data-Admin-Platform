const CRORE = 10000000;
const LAKH = 100000;


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


export function formatMoneyFull(value, { nullDash = false } = {}) {
    if (nullDash && (value === null || value === undefined)) {
        return "—";
    }
    const num = Number(value ?? 0);
    const sign = num < 0 ? "-" : "";
    const whole = Math.round(Math.abs(num));
    return `${sign}₹${whole.toLocaleString("en-IN")}`;
}


export function formatDelta(value, { nullDash = false } = {}) {
    if (nullDash && (value === null || value === undefined)) {
        return "—";
    }
    const num = Number(value ?? 0);
    const sign = num >= 0 ? "+" : "−";
    return `${sign}${Math.abs(num).toFixed(1)}%`;
}


export function formatDeltaSigned(value, { nullDash = false } = {}) {
    if (nullDash && (value === null || value === undefined)) {
        return "—";
    }
    const num = Number(value ?? 0);
    const sign = num >= 0 ? "+" : "-";
    return `${sign}${Math.abs(num).toFixed(1)}%`;
}
