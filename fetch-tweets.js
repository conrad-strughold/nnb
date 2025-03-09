const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('chromedriver');
const readline = require('readline');
const fs = require('fs').promises;

async function getTweets(username, count = 5) {
    let driver = await new Builder().forBrowser('chrome').build();

    try {
        await driver.get(`https://twitter.com/${username}`);
        console.log(`Please log in to Twitter for @${username}, then press Enter in the terminal to continue...`);

        // Wait for user input to proceed after login
        await new Promise(resolve => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            rl.question('', () => {
                rl.close();
                resolve();
            });
        });

        await driver.wait(until.elementsLocated(By.css('article')), 10000);

        let tweetElements = await driver.findElements(By.css('article'));
        let tweets = [];
        for (let i = 0; i < Math.min(count, tweetElements.length); i++) {
            let tweet = tweetElements[i];
            let tweetText = await tweet.findElement(By.css('div[lang]')).getText();
            let tweetLinkElement = await tweet.findElement(By.css('a[href*="/status/"]'));
            let tweetLink = await tweetLinkElement.getAttribute('href');
            tweets.push({ username: `@${username}`, text: tweetText, link: tweetLink });
        }

        return tweets;
    } catch (error) {
        console.error(`Error fetching tweets for @${username}:`, error);
        return [];
    } finally {
        await driver.quit();
    }
}

async function scrapeAndSaveTweets() {
    const accounts = ['saylor', 'bitcoinmagazine', 'BitcoinPierre'];
    let allTweets = [];

    for (const account of accounts) {
        const tweets = await getTweets(account, 5);
        allTweets = allTweets.concat(tweets);
        console.log(`Fetched ${tweets.length} tweets from @${account}`);
    }

    // Export to tweets.txt
    const tweetText = allTweets.map(tweet => `${tweet.username}: ${tweet.text} (Link: ${tweet.link})`).join('\n\n');
    await fs.writeFile('tweets.txt', tweetText);
    console.log('Tweets saved to tweets.txt');

    return allTweets;
}

// Run the function and log results
(async () => {
    const tweets = await scrapeAndSaveTweets();
    console.log('Last 5 tweets from each account:');
    tweets.forEach((tweet, index) => {
        console.log(`${index + 1}. ${tweet.username}: ${tweet.text} (Link: ${tweet.link})`);
    });
})();