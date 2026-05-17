const { spawn } = require("child_process");
const path = require("path");

const {
    YTDLP_DIR,
    OUTPUT_DIR
} = require("../utils/paths");

// Path ke executable yt-dlp yang akan dijalankan
const ytDlpPath = path.join(YTDLP_DIR, "yt-dlp.exe");

/**
 * runYtDlp
 * Helper untuk menjalankan `yt-dlp.exe` dengan argumen tertentu dan
 * menangani stdout/stderr, timeout, serta normalisasi output.
 *
 * Parameters:
 * - args: Array string, argumen yang akan diteruskan ke yt-dlp
 * - timeoutMs: number, millisecond sebelum proses dianggap timeout
 *
 * Returns: { child, promise }
 * - child: proses spawned (bisa digunakan untuk kill dari luar)
 * - promise: Promise yang resolve dengan output ter-normalize atau reject dengan error
 *
 * Behavior penting:
 * - Jika proses melebihi `timeoutMs`, child akan di-kill dan Promise reject
 * - Output dibersihkan dari baris kosong/whitespace agar mudah tampil di UI
 */
function runYtDlp(args, timeoutMs = 30000) {
    const child = spawn(ytDlpPath, args, {
        cwd: YTDLP_DIR
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Normalize output: trim setiap baris, buang baris kosong
    const normalizeOutput = (text = "") => {
        return text
            .toString()
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join("\n");
    };

    // Timeout safety: hentikan proses jika terlalu lama
    const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
    }, timeoutMs);

    const promise = new Promise((resolve, reject) => {
        // Kumpulkan stdout/stderr secara incremental
        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        // Error spawning atau masalah eksekusi
        child.on("error", (err) => {
            clearTimeout(timeout);
            reject(err.message || err);
        });

        // Process selesai: handling exit code / signal
        child.on("close", (code, signal) => {
            clearTimeout(timeout);

            if (timedOut) {
                return reject("Proses terlalu lama dan dibatalkan.");
            }

            if (signal) {
                return reject(`Proses dibatalkan (${signal}).`);
            }

            if (code !== 0) {
                // Gunakan stderr jika ada, atau pesan generik dengan kode exit
                return reject(normalizeOutput(stderr || `Perintah selesai dengan kode ${code}`));
            }

            // Resolve dengan output yang sudah rapi
            resolve(normalizeOutput(stdout));
        });
    });

    return { child, promise };
}


/**
 * getFormats
 * Mengambil daftar format yang tersedia untuk sebuah URL menggunakan yt-dlp
 * - Memanggil `yt-dlp -F <url>` untuk menampilkan semua format
 * - Mengembalikan object { child, promise } yang serupa dengan runYtDlp
 *
 * Usage: const { child, promise } = getFormats(url);
 * Promise akan resolve dengan string berisi daftar format.
 */
function getFormats(url) {
    return runYtDlp(["-F", url], 30000);
}


/**
 * downloadVideo
 * Mengunduh video dengan format tertentu.
 * - Menggunakan template output di OUTPUT_DIR: "%(title)s.%(ext)s"
 * - Secara default mengaktifkan resume (`-c`) sehingga download yang terpotong
 *   bisa dilanjutkan. Untuk menonaktifkan resume, panggil dengan opts.resume = false
 *
 * Parameters:
 * - url: string, URL video
 * - format: string, format code yang dipilih dari `getFormats`
 * - opts: object (optional)
 *   - resume: boolean (default: true) -> aktifkan flag `-c`
 *   - timeoutMs: number (ms) -> override timeout untuk proses download
 *
 * Returns: { child, promise }
 * - Promise resolve saat proses selesai dan mengembalikan output standar
 */
function downloadVideo(url, format, opts = {}) {
    const output = path.join(OUTPUT_DIR, "%(title)s.%(ext)s");
    const args = [];

    // Default: allow resuming partial downloads (useful untuk koneksi tidak stabil)
    if (opts.resume !== false) {
        args.push('-c');
    }

    // Argumen utama: format, output template, dan URL
    args.push('-f', format, '-o', output, url);

    // Download bisa memakan waktu lama; default timeout cukup besar (10 menit)
    return runYtDlp(args, opts.timeoutMs || 600000);
}

module.exports = {
    getFormats,
    downloadVideo
};