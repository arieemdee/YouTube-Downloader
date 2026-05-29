const path = require("path");
const fs = require("fs");

const BASE_DIR = process.pkg
    ? path.dirname(process.execPath)
    : __dirname + "/..";

const configPath = path.join(BASE_DIR, "config", "config.json");

const defaultConfig = {
    PORT: 3000,
    YTDLP_DIR: "./bin",
    OUTPUT_DIR: "./downloads",
    OUTPUT_MOVE: ""
};

function loadConfig() {
    if (!fs.existsSync(configPath)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    }

    return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function saveConfig(nextConfig) {
    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
}

const config = loadConfig();

module.exports = {
    BASE_DIR,
    config,
    loadConfig,
    saveConfig,
    YTDLP_DIR: path.join(BASE_DIR, config.YTDLP_DIR),
    OUTPUT_DIR: path.join(BASE_DIR, config.OUTPUT_DIR),
    OUTPUT_MOVE: config.OUTPUT_MOVE || ""
};