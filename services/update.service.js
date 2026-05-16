const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { YTDLP_DIR } = require("../utils/paths");

const YTDLP_RELEASES_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const YTDLP_PATH = path.join(YTDLP_DIR, "yt-dlp.exe");
const YTDLP_BACKUP = path.join(YTDLP_DIR, "yt-dlp.exe.backup");

// Timeout and retry defaults
const DEFAULT_API_TIMEOUT = 10000;       // 10 seconds untuk GitHub API
const DEFAULT_VERSION_TIMEOUT = 8000;    // 8 seconds untuk yt-dlp --version
const DEFAULT_DOWNLOAD_TIMEOUT = 30000;  // 30 seconds untuk download
const DOWNLOAD_RETRY_DELAY = 2000;      // 2 seconds antara retry

// 👇 CACHE CONFIGURATION - Untuk mengurangi pengecekan ke GitHub API
// Simpan hasil check update dalam file JSON agar tidak perlu hit API setiap kali
const CACHE_FILE = path.join(YTDLP_DIR, ".update-cache.json");
const CACHE_DURATION = 24 * 60 * 60 * 1000;  // 24 JAM dalam milliseconds

/**
 * FUNGSI HELPER 1: BACA CACHE DARI FILE
 * 
 * Tujuan:
 * - Membaca cache yang disimpan di file .update-cache.json
 * - Cache berisi informasi versi terbaru yang sudah pernah di-check
 * 
 * Cara Kerja:
 * - Cek apakah file CACHE_FILE ada di direktori bin
 * - Jika ada → baca file dan parse JSON
 * - Jika tidak ada → return null
 * 
 * Return:
 * - Object cache (jika file ada): { latestVersion, releaseDate, timestamp }
 * - null (jika file tidak ada atau error)
 * 
 * Kegunaan:
 * - Menghindari API calls yang tidak perlu
 * - Menghemat resource dan bandwidth
 * - Mempercepat response time
 */
function readCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, "utf8");
            return JSON.parse(data);
        }
    } catch (err) {
        console.log("Could not read cache file");
    }
    return null;
}

/**
 * FUNGSI HELPER 2: SIMPAN CACHE KE FILE
 * 
 * Tujuan:
 * - Menyimpan hasil check update ke file JSON
 * - Data ini bisa digunakan kembali sebelum 24 jam berlalu
 * 
 * Cara Kerja:
 * - Terima parameter data (latestVersion, releaseDate, etc)
 * - Tambahkan timestamp (waktu saat ini) ke dalam data
 * - Simpan ke file CACHE_FILE sebagai JSON format
 * 
 * Parameter:
 * - data: Object yang berisi { latestVersion, releaseDate }
 * 
 * Output:
 * - File JSON tersimpan di bin/.update-cache.json
 * 
 * Contoh file yang tersimpan:
 * {
 *   "latestVersion": "2024.12.16",
 *   "releaseDate": "2024-12-16T10:30:00Z",
 *   "timestamp": 1734334200000
 * }
 */
function saveCache(data) {
    try {
        const cacheData = {
            ...data,
            timestamp: Date.now()  // 👈 Simpan waktu cache dibuat (dalam milliseconds)
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    } catch (err) {
        console.log("Could not write cache file");
    }
}

/**
 * FUNGSI HELPER 3: CEK APAKAH CACHE MASIH VALID/SEGAR
 * 
 * Tujuan:
 * - Memastikan cache yang akan digunakan masih "aman" untuk dipakai
 * - Jika cache sudah lebih dari 24 jam, harus di-refresh dari API
 * 
 * Cara Kerja:
 * - Ambil timestamp dari cache (kapan cache dibuat)
 * - Hitung umur cache: sekarang - timestamp
 * - Bandingkan dengan CACHE_DURATION (24 jam)
 * 
 * LOGIKA:
 * Jika cache ada DAN umur < 24 jam → Cache VALID (gunakan cache)
 * Jika cache tidak ada ATAU umur ≥ 24 jam → Cache INVALID (refresh dari API)
 * 
 * Analogi Kehidupan Nyata:
 * - Cache = daftar belanja kemarin
 * - 24 jam = masa berlaku daftar belanja
 * - Jika masih dalam 24 jam → gunakan daftar lama
 * - Jika sudah > 24 jam → buat daftar baru (harga mungkin berubah)
 * 
 * Parameter:
 * - cache: Object dari readCache() { latestVersion, releaseDate, timestamp }
 * 
 * Return:
 * - true: Cache masih valid, boleh digunakan
 * - false: Cache sudah expired, perlu refresh dari API
 */
function isCacheValid(cache) {
    if (!cache || !cache.timestamp) {
        return false;  // Tidak ada cache, return false
    }
    
    const now = Date.now();
    const cacheAge = now - cache.timestamp;  // Umur cache dalam milliseconds
    
    // 👇 Jika cache umur-nya dibawah 24 jam, cache VALID
    return cacheAge < CACHE_DURATION;  // CACHE_DURATION = 24 jam dalam ms
}

/**
 * FUNGSI 1: MENGAMBIL VERSI TERBARU DARI GITHUB
 * 
 * Fungsi ini:
 * 1. Menghubungi GitHub API untuk mendapatkan release terbaru
 * 2. Parse response JSON dari GitHub
 * 3. Mencari file "yt-dlp.exe" di dalam release tersebut
 * 4. Return versi terbaru beserta URL untuk download
 */
function getLatestVersion(retries = 1) {
    return new Promise((resolve, reject) => {
        const attempt = (remaining) => {
            const options = {
                hostname: "api.github.com",
                path: "/repos/yt-dlp/yt-dlp/releases/latest",
                method: "GET",
                headers: {
                    "User-Agent": "youtube-gui-updater",
                    Accept: "application/vnd.github.v3+json"
                },
                timeout: DEFAULT_API_TIMEOUT
            };

            const req = https.request(options, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const redirectUrl = res.headers.location;
                    req.destroy();
                    if (redirectUrl) {
                        return resolve(getLatestVersion(remaining));
                    }
                }

                if (res.statusCode !== 200) {
                    let body = "";
                    res.on("data", (chunk) => body += chunk);
                    res.on("end", () => {
                        const message = `GitHub API returned ${res.statusCode}`;
                        if (remaining > 0) {
                            setTimeout(() => attempt(remaining - 1), DOWNLOAD_RETRY_DELAY);
                        } else {
                            reject(new Error(message));
                        }
                    });
                    return;
                }

                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });

                res.on("end", () => {
                    try {
                        const release = JSON.parse(data);
                        const downloadUrl = release.assets.find(
                            (asset) => asset.name === "yt-dlp.exe"
                        )?.browser_download_url;

                        if (!downloadUrl) {
                            return reject(new Error("yt-dlp.exe not found in latest release"));
                        }

                        resolve({
                            version: release.tag_name,
                            downloadUrl,
                            releaseDate: release.published_at
                        });
                    } catch (err) {
                        reject(err);
                    }
                });
            });

            req.on("timeout", () => {
                req.destroy();
                if (remaining > 0) {
                    setTimeout(() => attempt(remaining - 1), DOWNLOAD_RETRY_DELAY);
                } else {
                    reject(new Error("API request timeout - network connection unstable"));
                }
            });

            req.on("error", (err) => {
                if (remaining > 0) {
                    setTimeout(() => attempt(remaining - 1), DOWNLOAD_RETRY_DELAY);
                } else {
                    reject(err);
                }
            });

            req.end();
        };

        attempt(retries);
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
function getCurrentVersion(timeout = DEFAULT_VERSION_TIMEOUT) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(YTDLP_PATH)) {
            return resolve("unknown");
        }

        const child = spawn(YTDLP_PATH, ["--version"], {
            stdio: ["ignore", "pipe", "pipe"]
        });

        let output = "";
        let stderr = "";
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            if (child && !child.killed) child.kill();
            reject(new Error("Getting current version timed out"));
        }, timeout);

        child.stdout.on("data", (data) => {
            output += data.toString();
        });

        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });

        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (code !== 0 && !output.trim()) {
                const errMsg = stderr.trim() || `yt-dlp exited with code ${code}`;
                return reject(new Error(errMsg));
            }

            resolve(output.trim() || "unknown");
        });
    });
}

/**
 * FUNGSI 5: DOWNLOAD FILE DARI URL DENGAN RETRY LOGIC
 * 
 * Tujuan:
 * - Download file yt-dlp.exe dari GitHub dengan error handling
 * - Jika gagal, retry otomatis hingga 3 kali
 * - Handle timeout, network error, dan HTTP error
 * 
 * Cara Kerja:
 * 1. Buat stream untuk menulis file ke disk
 * 2. Hubungkan ke URL dan mulai download
 * 3. Handle berbagai error scenarios:
 *    - Redirect (301/302) → Follow redirect ke URL baru
 *    - HTTP error (bukan 200) → Reject dengan error message
 *    - Timeout → Retry otomatis
 *    - Connection error → Retry otomatis
 * 4. Setiap retry: tunggu 2 detik sebelum coba lagi
 * 5. Setelah 3 kali gagal → Return final error
 * 
 * Parameter:
 * - url: URL file yang akan di-download
 * - outputPath: Path lokal tempat file disimpan
 * - retries: Jumlah retry jika gagal (default: 3)
 * 
 * Return:
 * - Promise: resolve dengan outputPath jika sukses
 * - Promise: reject dengan error message jika gagal semua retry
 * 
 * Fitur Keamanan:
 * - Auto cleanup file temp jika error
 * - Handle broken connections
 * - Prevent half-downloaded files
 */
function downloadFile(url, outputPath, retries = 3) {
    return new Promise((resolve, reject) => {
        const attempt = (remaining) => {
            const file = fs.createWriteStream(outputPath);
            let timedOut = false;

            const req = https.get(url, {
                timeout: DEFAULT_DOWNLOAD_TIMEOUT
            }, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.destroy();
                    fs.unlink(outputPath, () => {});
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        return downloadFile(redirectUrl, outputPath, remaining).then(resolve).catch(reject);
                    }
                    return reject(new Error("Download redirect without location header"));
                }

                if (response.statusCode !== 200) {
                    file.destroy();
                    fs.unlink(outputPath, () => {});
                    return reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                }

                let downloadedBytes = 0;
                const totalBytes = parseInt(response.headers["content-length"], 10) || 0;

                response.on("data", (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const progress = Math.round((downloadedBytes / totalBytes) * 100);
                    }
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

                if (remaining > 0) {
                    console.log(`Download timeout, retrying... (${remaining} attempts left)`);
                    setTimeout(() => attempt(remaining - 1), DOWNLOAD_RETRY_DELAY);
                } else {
                    reject(new Error("Download timeout - failed after retries"));
                }
            });

            req.on("error", (err) => {
                file.destroy();
                fs.unlink(outputPath, () => {});

                if (!timedOut && remaining > 0) {
                    console.log(`Download error: ${err.message}, retrying... (${remaining} attempts left)`);
                    setTimeout(() => attempt(remaining - 1), DOWNLOAD_RETRY_DELAY);
                } else if (!timedOut) {
                    reject(err);
                }
            });
        };

        attempt(retries);
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
 * 1. CEK CACHE DULU - Jika ada cache yang masih valid (< 24 jam)
 *    → Gunakan cache (HEMAT RESOURCE, tidak hit API)
 * 2. Jika cache sudah expired atau tidak ada
 *    → Hit GitHub API untuk ambil versi terbaru
 * 3. Simpan hasilnya ke cache untuk penggunaan next time
 * 4. Bandingkan versi lama vs versi terbaru
 * 
 * KEUNTUNGAN:
 * - Refresh halaman berkali-kali tidak akan hit API berulang-ulang
 * - Hanya check API maksimal 1x per 24 jam
 * - Hemat resource & bandwidth
 */
async function checkForUpdate(retries = 2) {
    try {
        const cache = readCache();

        if (isCacheValid(cache)) {
            console.log("Using cached update check (still valid for 24h)");

            let currentVersion = "unknown";
            try {
                currentVersion = await getCurrentVersion();
            } catch (err) {
                console.log("Could not determine current version", err.message);
            }

            return {
                updateAvailable: currentVersion !== "unknown" && currentVersion !== cache.latestVersion,
                currentVersion,
                latestVersion: cache.latestVersion,
                releaseDate: cache.releaseDate,
                cached: true
            };
        }

        console.log("Cache expired or not found, checking GitHub API...");

        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const [latestInfo, currentVersion] = await Promise.all([
                    getLatestVersion(),
                    getCurrentVersion().catch((err) => {
                        console.log("Could not determine current version", err.message);
                        return "unknown";
                    })
                ]);

                const updateAvailable = currentVersion !== "unknown" && currentVersion !== latestInfo.version;

                saveCache({
                    latestVersion: latestInfo.version,
                    releaseDate: latestInfo.releaseDate
                });

                return {
                    updateAvailable,
                    currentVersion,
                    latestVersion: latestInfo.version,
                    releaseDate: latestInfo.releaseDate,
                    cached: false
                };
            } catch (err) {
                lastError = err;
                if (attempt < retries) {
                    console.log(`Check update failed, retrying... (attempt ${attempt + 1}/${retries})`);
                    await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_RETRY_DELAY));
                }
            }
        }

        if (cache) {
            return {
                updateAvailable: true,
                currentVersion: "unknown",
                latestVersion: cache.latestVersion,
                releaseDate: cache.releaseDate,
                cached: true,
                stale: true,
                error: lastError?.message || "Failed to check for update, using stale cache"
            };
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
    // 👇 FUNGSI UTAMA 1: Cek apakah ada update
    // Digunakan oleh: Routes GET /api/check-update
    // Mengembalikan: { updateAvailable, currentVersion, latestVersion, cached }
    checkForUpdate,
    
    // 👇 FUNGSI UTAMA 2: Jalankan proses update (download & replace)
    // Digunakan oleh: Routes POST /api/update
    // Mengembalikan: { status, message, currentVersion, latestVersion }
    updateYtDlp,
    
    // 👇 FUNGSI HELPER 1: Ambil versi terbaru dari GitHub API
    // Digunakan internally oleh: checkForUpdate, updateYtDlp
    // Mengembalikan: { version, downloadUrl, releaseDate }
    getLatestVersion,
    
    // 👇 FUNGSI HELPER 2: Ambil versi yang terinstall di local
    // Digunakan internally oleh: checkForUpdate, updateYtDlp
    // Mengembalikan: version string (contoh: "2024.12.10")
    getCurrentVersion,
    
    // 👇 FUNGSI HELPER 3: Hapus cache file untuk force refresh
    // Digunakan oleh: Routes POST /api/clear-update-cache
    // Mengembalikan: { success: true/false }
    clearUpdateCache: () => {
        try {
            if (fs.existsSync(CACHE_FILE)) {
                fs.unlinkSync(CACHE_FILE);
                console.log("Update cache cleared");
                return { success: true };
            }
        } catch (err) {
            console.log("Could not clear cache");
        }
        return { success: false };
    }
};
