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

module.exports = router;