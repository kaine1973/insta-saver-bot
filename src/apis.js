const axios = require("axios");
const {
    findMediaByShortCode,
    cleanTimelineResponse,
    waitFor,
    log,logError
} = require("./utils");
const { saveFromUrl } = require("./utils/helper");
const { INSTAGRAM_API_URL, MEDIA_TYPE } = require("./constants");
const { exec } = require("child_process");
const { Browser } = require("./config");

const fetchOwnerId = async (shortCode) => {
    try {
        const response = await axios.get(
            `${INSTAGRAM_API_URL}/?doc_id=17867389474812335&variables={"include_logged_out":true,"include_reel":false,"shortcode":"${shortCode}"}`
        );
        const ownerId = response?.data?.data?.shortcode_media?.owner?.id;

        if (ownerId) {
            return { success: true, data: ownerId };
        }
    } catch (error) {
        log("Error fetching owner ID:", error);
    }

    return { success: false };
};

const fetchTimelineData = async (ownerId, after = null) => {
    try {
        let url = `${INSTAGRAM_API_URL}/?doc_id=17991233890457762&variables={"id":"${ownerId}","first":50,"after":${
            after ? `"${after}"` : null
        }}`;
        const response = await axios.get(url);
        return { success: true, data: response.data };
    } catch (error) {
        log("Error fetching timeline data:", error?.response?.data);
    }
    return {
        success: false,
        message: "Error fetching timeline data. Please try again later.",
    };
};

const getStreamDataRecursively = async (shortCode, ownerId, after = null) => {
    const timelineResponse = await fetchTimelineData(ownerId, after);
    if (!timelineResponse.success) {
        return null;
    }

    const streamList =
        timelineResponse.data?.data?.user?.edge_owner_to_timeline_media
            ?.edges || [];
    const pageInfo =
        timelineResponse.data?.data?.user?.edge_owner_to_timeline_media
            ?.page_info;

    const mediaList = cleanTimelineResponse(streamList);
    const media = findMediaByShortCode(mediaList, shortCode);

    if (media) {
        return { data: media, success: true };
    }

    if (pageInfo?.has_next_page) {
        await waitFor(500);
        return getStreamDataRecursively(
            shortCode,
            ownerId,
            pageInfo.end_cursor
        );
    }

    return { success: false };
};

const getMediaUrl = async (instagramUrl) => {
    // Command to execute yt-dlp to fetch video URL
    const command = `./yt-dlp_linux -f b -g --cookies ./cookies.txt "${instagramUrl}"`;

    try {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`exec error: ${error}`);
                    return reject({ success: false, data: { mediaUrl: null } });
                }

                // If successful, stdout contains the direct video URL
                const mediaUrl = stdout.trim(); // Trim whitespace, if any
                resolve({
                    success: true,
                    data: {
                        mediaUrl,
                        mediaType: MEDIA_TYPE.VIDEO,
                    },
                });
            });
        });
    } catch (error) {
        log("failed in exec command: ", error);
        return { success: false, data: { mediaUrl: null } };
    }
};
// reuse browser and page.
let browser;
let page;
const scrapWithFastDl = async (requestUrl) => {
    if(browser == undefined){
        // first initiate.
        browser = await Browser.Open();
        page = await browser.newPage();

        // avoid new tab created by ads. wait for 10s to close new tab to "support" fastdl...
        browser.on("targetcreated", async (target)=>{
            const newPage = await target.page();
            if(newPage) {
                log('[Browser] new page opened, url is', newPage.url())
                setTimeout(() => {newPage.close()},10000)
                page.bringToFront()
            }
         });
    }
    const finalResponse = {
        data: {},
        success: false,
    };

    try {
        if(requestUrl.includes("/stories/")){
            await page.goto("https://fastdl.app/story-saver");
        }else{
            await page.goto("https://fastdl.app/en");
        }
        
        log("[Browser] browser page Went to fastdl");

        // Wait for the input field to be ready and type the URL
        await page.waitForSelector("#search-form-input");
        await page.type("#search-form-input", requestUrl, { delay: 10 });
        log("[Browser] Typed URL into input field");


        // Click the button with class search-form__button, type submit
        await page.evaluate(() => {
            const downloadButton = document.querySelector(
                '.search-form__button[type="submit"]'
            );
            if (downloadButton) {
                downloadButton.click();
            }
        });
        let a = 0
        while (true)
        {
            try {
                page.bringToFront();
                const captionElement = await page.waitForSelector(
                    ".output-list__caption",
                    { timeout: 5000 }
                );

                if (captionElement) {
                    const captionText = await page.evaluate(
                        (element) => element.textContent,
                        captionElement
                    );
                    finalResponse.data.caption = captionText.trim();
                }
            } catch (error) {
                log("[Browser] failed to scrap caption: ", error);
                
            }

            a++;
            if(a >= 3){
                log(`[Browser] scrap timeout ${a} times."`);
                break;
            }
            await waitFor(1000);
        }
            

        try {
            // Wait for the <ul> element to be present
            const ulElement = await page.waitForSelector(".output-list__list", {
                timeout: 5000,
            });

            if (ulElement) {
                // Evaluate in the context of the page to extract information from each <li> item
                const mediaList = await page.evaluate((ul) => {
                    const itemList = [];
                    // Select all <li> elements under the <ul>
                    const liElements =
                        ul.querySelectorAll(".output-list__item");

                    // Loop through each <li> element
                    liElements.forEach((li) => {
                        // Extract mediaUrl from <a> tag
                        const aTag = li.querySelector("a");
                        const mediaUrl = aTag ? aTag.href : "";

                        // Extract displayUrl from <img> tag
                        const imgTag = li.querySelector("img");
                        const displayUrl = imgTag ? imgTag.src : "";

                        // Extract mediaType from <span> tag
                        const spanTag = li.querySelector("span");
                        const classString = spanTag ? spanTag.className : "";

                        // Push the extracted data into itemList
                        itemList.push({ mediaUrl, displayUrl, classString });
                    });

                    return itemList;
                }, ulElement);

                // for (let i = 0; i < mediaList.length; i++) {
                //     console.log(mediaList[i]);
                // }
                log("[Browser] Scraped items count:", mediaList.length);
                let firstItem = {};
                if (mediaList.length > 1) {
                    finalResponse.data.mediaType = MEDIA_TYPE.MEDIA_GROUP;
                    firstItem = mediaList[0];

                    for (let i = 0; i < mediaList.length; i++) {
                        if (mediaList[i].classString.includes("video")) {
                            mediaList[i].mediaType = MEDIA_TYPE.VIDEO;
                        } else {
                            mediaList[i].mediaType = MEDIA_TYPE.IMAGE;
                        }
                    }
                } else if (mediaList.length === 1) {
                    firstItem = mediaList.shift();

                    if (firstItem.classString.includes("video")) {
                        finalResponse.data.mediaType = MEDIA_TYPE.VIDEO;
                    } else {
                        finalResponse.data.mediaType = MEDIA_TYPE.IMAGE;
                    }
                }
                finalResponse.data.mediaUrl = firstItem.mediaUrl;
                finalResponse.data.displayUrl = firstItem.displayUrl;
                finalResponse.data.mediaList = mediaList;
                finalResponse.success = true;
            } else {
                log("[Browser] ul element not found");
            }
        } catch (error) {
            log("[Browser] error scraping items:", error);
        }
    } catch (error) {
        log("[Browser] error in scraping:", error);
    } finally {
        // avoid close to reuse
        // page.close()
        log("[Browser] page 'not' closed after scraping");
    }

    return finalResponse;
};
const scrapWithSnapTik = async (requestUrl) => {
    if(browser == undefined){
        // first initiate.
        browser = await Browser.Open();
        page = await browser.newPage();

        // avoid new tab created by ads. wait for 10s to close new tab to "support" snaptik...
        browser.on("targetcreated", async (target)=>{
            const newPage = await target.page();
            if(newPage) {
                log('[Browser] new page opened, url is', newPage.url())
                setTimeout(() => {newPage.close()},10000)
                page.bringToFront()
            }
         });
    }
    const finalResponse = {
        data: {},
        success: false,
    };

    try {
        await page.goto("https://snaptik.life/en");
        
        log("[Browser] browser page Went to snaptik");

        // Wait for the input field to be ready and type the URL
        await page.waitForSelector("#input");
        await page.type("#input", requestUrl, { delay: 10 });
        log("[Browser] Typed URL into input field");


        // Click the button with class search-form__button, type submit
        await page.evaluate(() => {
            const downloadButton = document.querySelector(
                '.button--download[type="submit"]'
            );
            if (downloadButton) {
                downloadButton.click();
            }
        });
        let a = 0
        while (true)
        {
            try {
                page.bringToFront();
                const captionElement = await page.waitForSelector(
                    ".search-result-texts",
                    { timeout: 5000 }
                );

                if (captionElement) {
                    const captionText = await page.evaluate(
                        (element) => element.textContent,
                        captionElement
                    );
                    finalResponse.data.caption = captionText.trim();
                }
            } catch (error) {
                log("[Browser] failed to scrap caption: ", error);
                
            }

            a++;
            if(a >= 3){
                log(`[Browser] scrap timeout ${a} times."`);
                break;
            }
            await waitFor(1000);
        }
            

        try {
            // Wait for the <ul> element to be present
            const ulElement = await page.waitForSelector(".search-result__item", {
                timeout: 5000,
            });

            if (ulElement) {
                // Evaluate in the context of the page to extract information from each <li> item
                const mediaList = await page.evaluate((ul) => {
                    const itemList = [];

                    // Extract displayUrl from <img> tag
                    const imgTag = ul.querySelector(".search-result__item-img");
                    const displayUrl = imgTag ? imgTag.src : "";
                    // Select all <li> elements under the <ul>
                    const liElements =
                        ul.querySelectorAll(".search-result-download-main-item");
                    
                    let lastElement = liElements[liElements.length - 1];

                    // Extract mediaUrl from <a> tag
                    const aTag = lastElement.querySelector("a");
                    const mediaUrl = aTag ? aTag.href : "";


                    // Extract mediaType from <span> tag
                    const spanTag = lastElement.querySelector(".search-result-download-main-quality");
                    const classString = spanTag ? spanTag.textContent : "";
                    // Push the extracted data into itemList
                    itemList.push({ mediaUrl, displayUrl, classString });
                    

                    return itemList;
                }, ulElement);

                // for (let i = 0; i < mediaList.length; i++) {
                //     console.log(mediaList[i]);
                // }
                log("[Browser] Scraped items count:", mediaList.length);
                let firstItem = {};
                if (mediaList.length > 1) {
                    finalResponse.data.mediaType = MEDIA_TYPE.MEDIA_GROUP;
                    firstItem = mediaList[0];

                    for (let i = 0; i < mediaList.length; i++) {
                        if (mediaList[i].classString.includes("video") || mediaList[i].classString.includes("MP4")) {
                            mediaList[i].mediaType = MEDIA_TYPE.VIDEO;
                            const {result, file} = await saveFromUrl(mediaList[i].mediaUrl, mediaList[i].shortCode+".mp4" );
                            if(result){
                                mediaList[i].mediaUrl = fs.createReadStream(file)
                            }
                        } else {
                            mediaList[i].mediaType = MEDIA_TYPE.IMAGE;
                        }
                    }
                } else if (mediaList.length === 1) {
                    firstItem = mediaList.shift();

                    if (firstItem.classString.includes("video") || firstItem.classString.includes("MP4")) {
                        finalResponse.data.mediaType = MEDIA_TYPE.VIDEO;
                        const {result, file} = await saveFromUrl(firstItem.mediaUrl, "video.mp4");
                        if(result){
                            mediaList[i].mediaUrl = fs.createReadStream(file)
                        }
                    } else {
                        finalResponse.data.mediaType = MEDIA_TYPE.IMAGE;
                    }
                }
                finalResponse.data.mediaUrl = firstItem.mediaUrl;
                finalResponse.data.displayUrl = firstItem.displayUrl;
                finalResponse.data.mediaList = mediaList;
                finalResponse.success = true;
            } else {
                log("[Browser] ul element not found");
            }
        } catch (error) {
            log("[Browser] error scraping items:", error);
        }
    } catch (error) {
        log("[Browser] error in scraping:", error);
    } finally {
        // avoid close to reuse
        // page.close()
        log("[Browser] page 'not' closed after scraping");
    }

    return finalResponse;
};
module.exports = {
    fetchOwnerId,
    fetchTimelineData,
    getStreamDataRecursively,
    getMediaUrl,
    scrapWithFastDl, scrapWithSnapTik
};
