const fs = require("fs").promises;
const path = require("path");

const { OUTPUT_DIR } = require("../utils/paths");

async function listDownloadFiles() {
    try {
        const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name);
    } catch (err) {
        if (err.code === "ENOENT") {
            return [];
        }
        throw err;
    }
}

async function getDownloadFileCount() {
    const files = await listDownloadFiles();
    return files.length;
}

async function moveFile(srcPath, destPath) {
    try {
        await fs.rename(srcPath, destPath);
    } catch (err) {
        if (err.code === "EXDEV" || err.code === "EPERM" || err.code === "EACCES") {
            await fs.copyFile(srcPath, destPath);
            await fs.unlink(srcPath);
        } else {
            throw err;
        }
    }
}

async function moveDownloads(destination, onProgress = null) {
    if (!destination || typeof destination !== "string") {
        throw new Error("Destination path tidak valid.");
    }

    const trimmedDestination = destination.trim();
    if (
        !trimmedDestination ||
        (!trimmedDestination.startsWith("\\\\") && !/^[a-zA-Z]:[\\/]/.test(trimmedDestination))
    ) {
        throw new Error("Destination harus berupa path absolut, seperti \\\\server\\share atau C:\\folder.");
    }

    const files = await listDownloadFiles();
    if (!files.length) {
        return { moved: 0, files: [], destination: trimmedDestination };
    }

    await fs.mkdir(trimmedDestination, { recursive: true });

    const movedFiles = [];
    for (let index = 0; index < files.length; index += 1) {
        const filename = files[index];
        const src = path.join(OUTPUT_DIR, filename);
        const dest = path.join(trimmedDestination, filename);
        await moveFile(src, dest);
        movedFiles.push(filename);

        if (typeof onProgress === "function") {
            const completed = movedFiles.length;
            const percent = files.length ? Math.round((completed / files.length) * 100) : 100;
            onProgress({
                completed,
                total: files.length,
                filename,
                percent,
                destination: trimmedDestination
            });
        }
    }

    return {
        moved: movedFiles.length,
        files: movedFiles,
        destination: trimmedDestination
    };
}

module.exports = {
    getDownloadFileCount,
    moveDownloads
};
