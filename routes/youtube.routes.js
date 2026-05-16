const express = require("express");

const router = express.Router();

const {
    getFormats,
    downloadVideo
} = require("../services/youtube.service");

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
            res.send(result);
        }
    } catch (err) {
        if (!req.aborted && !res.headersSent) {
            res.send(
                "❌ Gagal mengambil format\n\n" + err
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
                "✅ Download selesai!\n\n" + result
            );
        }
    } catch (err) {
        if (!req.aborted && !res.headersSent) {
            res.send(
                "❌ Download gagal\n\n" + err
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

    res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    // helper to send SSE data (preserve newlines)
    const sendData = (chunk) => {
        const text = chunk.toString();
        const lines = text.split(/\r?\n/);
        lines.forEach((line) => {
            if (line.length > 0) {
                res.write(`data: ${line}\n\n`);
            }
        });
    };

    const onStdout = (data) => sendData(data);
    const onStderr = (data) => sendData(data);

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);

    const onCloseReq = () => {
        if (child && !child.killed) child.kill("SIGTERM");
    };

    req.on("close", onCloseReq);

    promise.then((result) => {
        // send final message and close
        const final = (result || "").toString();
        const lines = final.split(/\r?\n/).filter(Boolean);
        lines.forEach((line) => res.write(`data: ${line}\n\n`));
        res.write(`event: done\ndata: ✅ Download selesai\n\n`);
        res.end();
    }).catch((err) => {
        const msg = err && err.toString ? err.toString() : JSON.stringify(err);
        const lines = msg.split(/\r?\n/).filter(Boolean);
        lines.forEach((line) => res.write(`data: ${line}\n\n`));
        res.write(`event: error\ndata: ❌ Download gagal\n\n`);
        res.end();
    }).finally(() => {
        child.stdout.off("data", onStdout);
        child.stderr.off("data", onStderr);
        req.off("close", onCloseReq);
    });
});

module.exports = router;