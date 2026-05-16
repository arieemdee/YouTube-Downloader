const { spawn } = require("child_process");
const path = require("path");

const {
    YTDLP_DIR,
    OUTPUT_DIR
} = require("../utils/paths");

const ytDlpPath = path.join(YTDLP_DIR, "yt-dlp.exe");

function runYtDlp(args, timeoutMs = 30000) {
    const child = spawn(ytDlpPath, args, {
        cwd: YTDLP_DIR
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
    }, timeoutMs);

    const promise = new Promise((resolve, reject) => {
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        child.on("error", (err) => {
            clearTimeout(timeout);
            reject(err.message || err);
        });

        child.on("close", (code, signal) => {
            clearTimeout(timeout);

            if (timedOut) {
                return reject("Proses terlalu lama dan dibatalkan.");
            }

            if (signal) {
                return reject(`Proses dibatalkan (${signal}).`);
            }

            if (code !== 0) {
                return reject(stderr || `Perintah selesai dengan kode ${code}`);
            }

            resolve(stdout);
        });
    });

    return { child, promise };
}

function getFormats(url) {
    return runYtDlp(["-F", url], 30000);
}

function downloadVideo(url, format) {
    const output = path.join(OUTPUT_DIR, "%(title)s.%(ext)s");
    return runYtDlp(["-f", format, "-o", output, url], 600000);
}

module.exports = {
    getFormats,
    downloadVideo
};