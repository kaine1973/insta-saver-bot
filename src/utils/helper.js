const { log } = require("./logs");
const https = require('https');
const waitFor = async (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
};

const findMediaByShortCode = (mediaList, shortCode) => {
    return mediaList.find((media) => media.shortCode === shortCode) || null;
};

const isValidInstaUrl = (url) => {
    let response = {
        success: false,
        url,
    };

    try {
        const { host, pathname } = new URL(url);

        if (host === "www.instagram.com") {
            response.success = true;
            response.shortCode = url;
            return response;
        }
        [type,shortCode] = pathname.trim().split("/").slice(1,3);
        log("[Bot] share link type is: "+type)
        if (type === "stories" || type === "p") {
            return {
                url: url,
                shortCode,
                success: true,
            };
        }
        return response;
    } catch (error) {
        log("error in isValid : ", error);
        log("caused by : ", url);
        return response;
    }
};
const isValidTikTokUrl = (url) => {
    let response = {
        success: false,
        url,
    };

    try {
        const { host, pathname } = new URL(url);

        if (host === "vt.tiktok.com") {

            response.success = true;
            response.shortCode = pathname.substring(1);
            return response;
        }
        return response;
    } catch (error) {
        log("error in isValid : ", error);
        log("caused by : ", url);
        return response;
    }
};

const saveFromUrl = async (url, fileName) =>{
    const fs = require('fs');

    const file = fs.createWriteStream('/tmp/' + fileName);
    const request = await https.get(url, function(response) {
        response.pipe(file);

        // after download completed close filestream
        file.on("finish", () => {
            file.close();
            log("[helper]Download Completed: " + fileName);
        });
    });
    return true;
}
module.exports = {
    waitFor,
    findMediaByShortCode,
    isValidInstaUrl,
    isValidTikTokUrl,
    saveFromUrl
};
