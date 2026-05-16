const https = require("https");
const fs = require("fs");
const path = require("path");
const { YTDLP_DIR } = require("../utils/paths");

const YTDLP_RELEASES_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const YTDLP_PATH = path.join(YTDLP_DIR, "yt-dlp.exe");
const YTDLP_BACKUP = path.join(YTDLP_DIR, "yt-dlp.exe.backup");

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
        const attempt = () => {
            const file = fs.createWriteStream(outputPath);
            let timedOut = false;

            const req = https.get(url, {
                timeout: 30000  // 30 detik timeout
            }, (response) => {
                // 👇 Handle HTTP redirects (301, 302)
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.destroy();
                    fs.unlink(outputPath, () => {});
                    downloadFile(response.headers.location, outputPath, retries)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                // 👇 Handle non-200 HTTP responses
                if (response.statusCode !== 200) {
                    file.destroy();
                    fs.unlink(outputPath, () => {});
                    reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                    return;
                }

                // 👇 Track download progress (optional)
                let downloadedBytes = 0;
                const totalBytes = parseInt(response.headers["content-length"], 10);

                response.on("data", (chunk) => {
                    downloadedBytes += chunk.length;
                    const progress = Math.round((downloadedBytes / totalBytes) * 100);
                    // Progress dapat digunakan untuk UI progress bar
                });

                response.pipe(file);

                file.on("finish", () => {
                    file.close();
                    resolve(outputPath);  // 👈 SUCCESS
                });

                file.on("error", (err) => {
                    fs.unlink(outputPath, () => {});
                    reject(err);
                });
            });

            // 👇 Handle timeout
            req.on("timeout", () => {
                timedOut = true;
                req.destroy();
                file.destroy();
                fs.unlink(outputPath, () => {});
                
                if (retries > 0) {
                    console.log(`Download timeout, retrying... (${retries} attempts left)`);
                    setTimeout(() => attempt(), 2000);  // Wait 2s before retry
                } else {
                    reject(new Error("Download timeout - failed after 3 retries"));
                }
            });

            // 👇 Handle connection errors
            req.on("error", (err) => {
                file.destroy();
                fs.unlink(outputPath, () => {});
                
                if (!timedOut && retries > 0) {
                    console.log(`Download error: ${err.message}, retrying... (${retries} attempts left)`);
                    setTimeout(() => attempt(), 2000);  // Wait 2s before retry
                } else if (!timedOut) {
                    reject(err);
                }
            });
        };

        attempt();  // 👈 Mulai attempt pertama
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
        // 👇 LANGKAH 1: CEK CACHE DULU
        const cache = readCache();
        
        if (isCacheValid(cache)) {
            console.log("Using cached update check (still valid for 24h)");
            
            // Ambil versi yang terinstall saat ini
            let currentVersion = "unknown";
            try {
                currentVersion = await getCurrentVersion();
            } catch (err) {
                console.log("Could not determine current version");
            }
            
            // Return hasil dari cache, tapi perbarui currentVersion
            // karena versi terinstall bisa berubah setelah update manual
            return {
                updateAvailable: currentVersion !== cache.latestVersion,
                currentVersion,
                latestVersion: cache.latestVersion,
                releaseDate: cache.releaseDate,
                cached: true  // 👈 Tandai bahwa ini dari cache
            };
        }

        console.log("Cache expired or not found, checking GitHub API...");
        
        // 👇 LANGKAH 2: CACHE TIDAK ADA/EXPIRED, HIT API
        let lastError = null;
        
        for (let i = 0; i <= retries; i++) {
            try {
                const latestInfo = await getLatestVersion();
                let currentVersion = "unknown";

                try {
                    currentVersion = await getCurrentVersion();
                } catch (err) {
                    console.log("Could not determine current version");
                }

                const updateAvailable = currentVersion !== latestInfo.version;

                // 👇 LANGKAH 3: SIMPAN HASIL KE CACHE UNTUK PENGGUNAAN NANTI
                saveCache({
                    latestVersion: latestInfo.version,
                    releaseDate: latestInfo.releaseDate
                });

                return {
                    updateAvailable,
                    currentVersion,
                    latestVersion: latestInfo.version,
                    releaseDate: latestInfo.releaseDate,
                    cached: false  // 👈 Tandai bahwa ini fresh dari API
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
