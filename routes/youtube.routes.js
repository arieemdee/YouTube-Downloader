const express = require("express");

const router = express.Router();

const normalizeOutput = (text = "") => {
    return text
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
};

// Map of active downloads: id -> { child }
const downloads = new Map();

const {
    getFormats,
    downloadVideo
} = require("../services/youtube.service");

const {
    updateYtDlp,
    checkForUpdate
} = require("../services/update.service");

router.post("/formats", async (req, res) => {
    const { url } = req.body;
    const { child, promise } = getFormats(url);

    const onAbort = () => {
        if (child && !child.killed) {
            child.kill("SIGTERM");
        }
    };

    req.on("aborted", onAbort);

    try {
        const result = await promise;
        if (!req.aborted && !res.headersSent) {
            res.send(normalizeOutput(result));
        }
    } catch (err) {
        if (!req.aborted && !res.headersSent) {
            res.send(
                "❌ Gagal mengambil format\n\n" + normalizeOutput(err)
            );
        }
    } finally {
        req.off("aborted", onAbort);
    }
});

router.post("/download", async (req, res) => {
    const { url, format } = req.body;
    const { child, promise } = downloadVideo(url, format);

    

    const onAbort = () => {
        if (child && !child.killed) {
            child.kill("SIGTERM");
        }
    };

    req.on("aborted", onAbort);

    try {
        const result = await promise;
        if (!req.aborted && !res.headersSent) {
            res.send(
                "✅ Download selesai!\n\n" + normalizeOutput(result)
            );
        }
    } catch (err) {
        if (!req.aborted && !res.headersSent) {
            res.send(
                "❌ Download gagal\n\n" + normalizeOutput(err)
            );
        }
    } finally {
        req.off("aborted", onAbort);
    }
});

// Server-Sent Events (SSE) route to stream download progress in real-time
router.get("/download-stream", (req, res) => {
    const url = req.query.url;
    const format = req.query.format;

    if (!url || !format) {
        return res.status(400).send("Missing url or format query parameters.");
    }

    const { child, promise } = downloadVideo(url, format);

    // create and expose an id for this download so clients can cancel
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    downloads.set(id, { child });

    res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    // send initial id event
    res.write(`event: id\ndata: ${id}\n\n`);

    // helper to parse progress and send SSE events
    const parseAndSend = (chunk) => {
        const text = chunk.toString();

        // try to extract percentage like "12.3%" from yt-dlp output
        const m = text.match(/(\d{1,3}(?:\.\d+)?)%/);
        if (m) {
            const pct = parseFloat(m[1]);
            if (!Number.isNaN(pct)) {
                res.write(`event: progress\ndata: ${pct}\n\n`);
            }
        }

        // forward other lines as normal messages
        const lines = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        lines.forEach((line) => res.write(`data: ${line}\n\n`));
    };

    const onStdout = (data) => parseAndSend(data);
    const onStderr = (data) => parseAndSend(data);

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);

    const onCloseReq = () => {
        if (child && !child.killed) child.kill("SIGTERM");
        // remove from downloads map if client closes connection
        try { downloads.delete(id); } catch (e) {}
    };

    req.on("close", onCloseReq);

    promise.then(() => {
        // close after the process completes
        res.write(`event: done\ndata: ✅ Download selesai\n\n`);
        res.end();
    }).catch((err) => {
        const msg = err && err.toString ? err.toString() : JSON.stringify(err);
        const lines = msg
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        lines.forEach((line) => res.write(`data: ${line}\n\n`));
        res.write(`event: error\ndata: ❌ Download gagal\n\n`);
        res.end();
    }).finally(() => {
        // cleanup stored child
        downloads.delete(id);
        child.stdout.off("data", onStdout);
        child.stderr.off("data", onStderr);
        req.off("close", onCloseReq);
    });
});

// Cancel a running download by id
router.post('/download-cancel', (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

    const entry = downloads.get(id);
    if (!entry) return res.status(404).json({ ok: false, error: 'Download not found' });

    try {
        const { child } = entry;
        if (child && !child.killed) {
            child.kill('SIGTERM');
        }
        downloads.delete(id);
        return res.json({ ok: true });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err && err.toString ? err.toString() : 'Error' });
    }
});

// Check for yt-dlp update
router.get('/check-update', async (req, res) => {
    try {
        const result = await checkForUpdate();
        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: err.message || 'Failed to check for update'
        });
    }
});

// Update yt-dlp to latest version
router.post('/update', async (req, res) => {
    try {
        const result = await updateYtDlp();
        res.json(result);
    } catch (err) {
        res.status(500).json({
            status: 'error',
            error: err.message || 'Failed to update yt-dlp'
        });
    }
});

module.exports = router;