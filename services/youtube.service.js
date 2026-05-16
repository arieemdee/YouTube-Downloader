const { exec } = require("child_process");
const path = require("path");

const {
    YTDLP_DIR,
    OUTPUT_DIR
} = require("../utils/paths");

const ytDlpPath = path.join(YTDLP_DIR, "yt-dlp.exe");

function getFormats(url) {

    return new Promise((resolve, reject) => {

        const command =
            `"${ytDlpPath}" -F "${url}"`;

        exec(command, {
            cwd: YTDLP_DIR
        }, (error, stdout, stderr) => {

            if (error) {
                return reject(stderr);
            }

            resolve(stdout);
        });

    });

}

function downloadVideo(url, format) {

    return new Promise((resolve, reject) => {

        const command =
            `"${ytDlpPath}" -f ${format} -o "${OUTPUT_DIR}\\%(title)s.%(ext)s" "${url}"`;

        exec(command, {
            cwd: YTDLP_DIR
        }, (error, stdout, stderr) => {

            if (error) {
                return reject(stderr);
            }

            resolve(stdout);

        });

    });

}

module.exports = {
    getFormats,
    downloadVideo
};