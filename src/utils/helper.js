const { log } = require("./logs");
const https = require('https');
const fs = require('fs');
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
    async function download(url, filePath) {
        const proto = !url.charAt(4).localeCompare('s') ? https : http;
      
        return new Promise((resolve, reject) => {
          const file = fs.createWriteStream(filePath);
          let fileInfo = null;
      
          const request = proto.get(url, response => {
            if (response.statusCode !== 200) {
              fs.unlink(filePath, () => {
                reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
              });
              return;
            }
      
            fileInfo = {
              mime: response.headers['content-type'],
              size: parseInt(response.headers['content-length'], 10),
            };
      
            response.pipe(file);
          });
      
          // The destination stream is ended by the time it's called
          file.on('finish', () => resolve(fileInfo));
      
          request.on('error', err => {
            fs.unlink(filePath, () => reject(err));
          });
      
          file.on('error', err => {
            fs.unlink(filePath, () => reject(err));
          });
      
          request.end();
        });
      }
    const file = '/tmp/'+fileName
    await download(url, file);
    log("[Helper]file saved to : ", file);
    return {result: true, file: file};
}
module.exports = {
    waitFor,
    findMediaByShortCode,
    isValidInstaUrl,
    isValidTikTokUrl,
    saveFromUrl
};
