const https = require("https");
const fs = require("fs");
const path = require("path");
const { YTDLP_DIR } = require("../utils/paths");

const YTDLP_RELEASES_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const YTDLP_PATH = path.join(YTDLP_DIR, "yt-dlp.exe");
const YTDLP_BACKUP = path.join(YTDLP_DIR, "yt-dlp.exe.backup");

/**
 * FUNGSI 1: MENGAMBIL VERSI TERBARU DARI GITHUB
 * 
 * Fungsi ini:
 * 1. Menghubungi GitHub API untuk mendapatkan release terbaru
 * 2. Parse response JSON dari GitHub
 * 3. Mencari file "yt-dlp.exe" di dalam release tersebut
 * 4. Return versi terbaru beserta URL untuk download
 */
function getLatestVersion() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: "api.github.com",
            path: "/repos/yt-dlp/yt-dlp/releases/latest", // 👈 Ambil release TERBARU
            method: "GET",
            headers: {
                "User-Agent": "youtube-gui-updater"
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = "";

            // Kumpulkan semua response data
            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                try {
                    // Parse JSON response dari GitHub
                    const release = JSON.parse(data);
                    
                    // 👇 DETEKSI VERSI TERBARU: ambil dari field "tag_name"
                    // Contoh: "2024.12.16" atau "2025.01.15"
                    const downloadUrl = release.assets.find(
                        (asset) => asset.name === "yt-dlp.exe"
                    )?.browser_download_url;

                    if (!downloadUrl) {
                        reject(new Error("yt-dlp.exe not found in latest release"));
                    }

                    resolve({
                        version: release.tag_name,        // 👈 INI VERSI TERBARU (dari GitHub)
                        downloadUrl: downloadUrl,
                        releaseDate: release.published_at
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("API request timeout - network connection unstable"));
        });
        req.end();
    });
}

/**
 * FUNGSI 2: MENGAMBIL VERSI YANG SUDAH TERINSTALL (VERSI LAMA)
 * 
 * Fungsi ini:
 * 1. Menjalankan command: yt-dlp.exe --version
 * 2. Menangkap output/hasil dari command tersebut
 * 3. Mengambil version string dan return ke function pemanggil
 * 
 * Cara kerja:
 * - Ketika anda buka CMD/Terminal dan ketik: yt-dlp.exe --version
 * - Maka akan keluar output seperti: "2024.12.10"
 * - Kita mengambil output itu sebagai versi saat ini (versi lama)
 */
function getCurrentVersion() {
    return new Promise((resolve, reject) => {
        const { spawn } = require("child_process");
        
        // Jalankan: yt-dlp.exe --version
        const child = spawn(YTDLP_PATH, ["--version"]);

        let output = "";

        // Kumpulkan output dari stdout
        child.stdout.on("data", (data) => {
            output += data.toString();
        });

        // Saat process selesai
        child.on("close", () => {
            try {
                // 👇 DETEKSI VERSI LAMA: trim output string
                // Contoh output: "2024.12.10\n" → di-trim menjadi "2024.12.10"
                const version = output.trim();
                resolve(version);  // 👈 INI VERSI LAMA (dari file yang terinstall)
            } catch (err) {
                reject(err);
            }
        });

        child.on("error", reject);
    });
}

/**
 * Download file from URL with retry logic
 */
function downloadFile(url, outputPath, retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = () => {
            const file = fs.createWriteStream(outputPath);
            let timedOut = false;

            const req = https.get(url, {
                timeout: 30000
            }, (response) => {
                // Handle redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.destroy();
                    fs.unlink(outputPath, () => {});
                    downloadFile(response.headers.location, outputPath, retries)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    file.destroy();
                    fs.unlink(outputPath, () => {});
                    reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                    return;
                }

                let downloadedBytes = 0;
                const totalBytes = parseInt(response.headers["content-length"], 10);

                response.on("data", (chunk) => {
                    downloadedBytes += chunk.length;
                    const progress = Math.round((downloadedBytes / totalBytes) * 100);
                });

                response.pipe(file);

                file.on("finish", () => {
                    file.close();
                    resolve(outputPath);
                });

                file.on("error", (err) => {
                    fs.unlink(outputPath, () => {});
                    reject(err);
                });
            });

            req.on("timeout", () => {
                timedOut = true;
                req.destroy();
                file.destroy();
                fs.unlink(outputPath, () => {});
                
                if (retries > 0) {
                    console.log(`Download timeout, retrying... (${retries} attempts left)`);
                    setTimeout(() => attempt(), 2000);
                } else {
                    reject(new Error("Download timeout - failed after 3 retries"));
                }
            });

            req.on("error", (err) => {
                file.destroy();
                fs.unlink(outputPath, () => {});
                
                if (!timedOut && retries > 0) {
                    console.log(`Download error: ${err.message}, retrying... (${retries} attempts left)`);
                    setTimeout(() => attempt(), 2000);
                } else if (!timedOut) {
                    reject(err);
                }
            });
        };

        attempt();
    });
}

/**
 * FUNGSI 4: MELAKUKAN PROSES UPDATE (JIKA ADA VERSI BARU)
 * 
 * Fungsi ini akan:
 * 1. Mengambil versi terbaru dari GitHub
 * 2. Mengambil versi yang terinstall saat ini
 * 3. Membandingkan apakah sama atau berbeda
 * 4. Jika berbeda → Download versi baru dan replace file lama
 * 5. Jika sama → Beri tahu bahwa sudah versi terbaru
 */
async function updateYtDlp() {
    try {
        // Check if bin directory exists
        if (!fs.existsSync(YTDLP_DIR)) {
            fs.mkdirSync(YTDLP_DIR, { recursive: true });
        }

        // 👇 AMBIL VERSI TERBARU DARI GITHUB
        let latestInfo = null;
        let lastError = null;
        
        for (let i = 0; i < 3; i++) {
            try {
                latestInfo = await getLatestVersion();  // Ambil dari GitHub
                break;
            } catch (err) {
                lastError = err;
                if (i < 2) {
                    console.log(`Failed to get version info, retrying... (attempt ${i + 1}/3)`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        if (!latestInfo) {
            return {
                status: "error",
                message: `Failed to get latest version: ${lastError?.message}`,
                error: lastError?.message
            };
        }

        // 👇 AMBIL VERSI LAMA YANG TERINSTALL
        let currentVersion = "unknown";
        try {
            currentVersion = await getCurrentVersion();  // Ambil dari file terinstall
        } catch (err) {
            console.log("Could not determine current version");
        }

        // 👇 PERBANDINGAN VERSI: Apakah currentVersion === latestVersion?
        // Jika SAMA: tidak perlu update, return message
        // Jika BERBEDA: lanjut ke proses download dan replace
        if (currentVersion === latestInfo.version) {
            return {
                status: "already_latest",
                message: `Already on latest version: ${currentVersion}`,
                currentVersion,
                latestVersion: latestInfo.version
            };
        }

        // Backup current version (sebagai backup untuk jaga-jaga)
        if (fs.existsSync(YTDLP_PATH)) {
            try {
                fs.copyFileSync(YTDLP_PATH, YTDLP_BACKUP);
            } catch (err) {
                console.log("Could not create backup");
            }
        }

        // Download new version
        const tempPath = path.join(YTDLP_DIR, "yt-dlp.exe.tmp");
        await downloadFile(latestInfo.downloadUrl, tempPath);

        // Replace old version dengan yang baru
        if (fs.existsSync(YTDLP_PATH)) {
            fs.unlinkSync(YTDLP_PATH);  // Hapus file lama
        }
        fs.renameSync(tempPath, YTDLP_PATH);  // Rename file baru ke nama asli

        // Clean up backup
        if (fs.existsSync(YTDLP_BACKUP)) {
            try {
                fs.unlinkSync(YTDLP_BACKUP);
            } catch (err) {
                console.log("Could not delete backup");
            }
        }

        return {
            status: "success",
            message: `Successfully updated from ${currentVersion} to ${latestInfo.version}`,
            currentVersion,
            latestVersion: latestInfo.version
        };
    } catch (error) {
        // Restore backup jika update gagal
        if (fs.existsSync(YTDLP_BACKUP)) {
            try {
                if (fs.existsSync(YTDLP_PATH)) {
                    fs.unlinkSync(YTDLP_PATH);
                }
                fs.renameSync(YTDLP_BACKUP, YTDLP_PATH);
            } catch (err) {
                console.log("Could not restore backup");
            }
        }

        return {
            status: "error",
            message: `Update failed: ${error.message}`,
            error: error.message
        };
    }
}

/**
 * FUNGSI 3: MENGECEK APAKAH ADA UPDATE YANG TERSEDIA
 * 
 * Fungsi ini akan:
 * 1. Mengambil versi terbaru dari GitHub
 * 2. Mengambil versi yang terinstall saat ini
 * 3. MEMBANDINGKAN keduanya
 * 4. Return hasil perbandingan
 */
async function checkForUpdate(retries = 2) {
    try {
        let lastError = null;
        
        for (let i = 0; i <= retries; i++) {
            try {
                // 👇 AMBIL VERSI TERBARU DARI GITHUB
                const latestInfo = await getLatestVersion();
                
                // 👇 AMBIL VERSI LAMA YANG TERINSTALL
                let currentVersion = "unknown";

                try {
                    currentVersion = await getCurrentVersion();
                } catch (err) {
                    console.log("Could not determine current version");
                }

                // 👇 PERBANDINGAN VERSI
                // Jika SAMA: tidak perlu update
                // Jika BERBEDA: ada update tersedia
                const updateAvailable = currentVersion !== latestInfo.version;

                return {
                    updateAvailable,           // true = ada update, false = tidak ada update
                    currentVersion,            // Versi lama (dari file yang terinstall)
                    latestVersion: latestInfo.version,  // Versi terbaru (dari GitHub)
                    releaseDate: latestInfo.releaseDate
                };
            } catch (err) {
                lastError = err;
                if (i < retries) {
                    console.log(`Check update failed, retrying... (attempt ${i + 1}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        return {
            error: lastError?.message || "Failed to check for update",
            updateAvailable: null
        };
    } catch (error) {
        return {
            error: error.message,
            updateAvailable: null
        };
    }
}

module.exports = {
    updateYtDlp,
    checkForUpdate,
    getLatestVersion,
    getCurrentVersion
};
