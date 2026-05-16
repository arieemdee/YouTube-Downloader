const express = require("express");
const path = require("path");

const youtubeRoutes =
    require("./routes/youtube.routes");

const { config } =
    require("./utils/paths");

const app = express();

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

// STATIC FILE
app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// API
app.use("/api", youtubeRoutes);

app.listen(config.PORT, () => {

    console.log("=================================");
    console.log("YouTube Downloader Running");
    console.log("=================================");

    console.log(
        `http://localhost:${config.PORT}`
    );

});