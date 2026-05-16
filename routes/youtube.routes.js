const express = require("express");

const router = express.Router();

const {
    getFormats,
    downloadVideo
} = require("../services/youtube.service");

router.post("/formats", async (req, res) => {

    try {

        const { url } = req.body;

        const result = await getFormats(url);

        res.send(result);

    } catch (err) {

        res.send(
            "❌ Gagal mengambil format\n\n" + err
        );

    }

});

router.post("/download", async (req, res) => {

    try {

        const { url, format } = req.body;

        const result =
            await downloadVideo(url, format);

        res.send(
            "✅ Download selesai!\n\n" + result
        );

    } catch (err) {

        res.send(
            "❌ Download gagal\n\n" + err
        );

    }

});

module.exports = router;