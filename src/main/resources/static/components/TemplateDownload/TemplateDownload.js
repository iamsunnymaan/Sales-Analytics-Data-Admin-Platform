// Shared fetch→blob→save-as algorithm for any "hit this URL, save the response as a file" button
// (Template Download on DataUploadPage/ExplorerPage, DataUploadPage's own history re-download).
// Previously copy-pasted three times (DataUploadPage.js's inline templateBtn handler, its own
// downloadFile helper, and ExplorerPage.js's triggerDownload) — this is the one copy.
//
// Throws on failure instead of showing any message itself — every call site keeps its own
// try/catch and its own existing error text, since that varies per page today and isn't part of
// this algorithm's job.
export async function triggerUrlDownload(url, filenameFallback) {
    const response = await fetch(url);
    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.message || `Download failed with status ${response.status}`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : filenameFallback;

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}
