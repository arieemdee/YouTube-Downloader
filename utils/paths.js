const path = require("path");
const fs = require("fs");

const BASE_DIR = process.pkg
    ? path.dirname(process.execPath)
    : __dirname + "/..";

const configPath = path.join(BASE_DIR, "config", "config.json");

const defaultConfig = {
    PORT: 3000,
    YTDLP_DIR: "./bin",
    OUTPUT_DIR: "./downloads"
};

// Auto create config
if (!fs.existsSync(configPath)) {

    fs.mkdirSync(path.dirname(configPath), {
        recursive: true
    });

    fs.writeFileSync(
        configPath,
        JSON.stringify(defaultConfig, null, 2)
    );
}

const config = JSON.parse(
    fs.readFileSync(configPath, "utf8")
);

module.exports = {
    BASE_DIR,
    config,
    YTDLP_DIR: path.join(BASE_DIR, config.YTDLP_DIR),
    OUTPUT_DIR: path.join(BASE_DIR, config.OUTPUT_DIR)
};