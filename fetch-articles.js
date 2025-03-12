const fs = require('fs').promises;
const path = require('path');
const Parser = require('rss-parser');
const parser = new Parser();
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const readline = require('readline');

const LOGIN_FILE = 'loggedIn.txt';

async function fetchBitcoinPrice() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        const data = await response.json();
        return data.bitcoin.usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    } catch (error) {
        console.error('Error fetching Bitcoin price:', error);
        return '$00,000';
    }
}

async function getTweets(username, count = 5) {
    // Use a persistent Chrome profile to stay logged in
    const chromeOptions = new chrome.Options();
    chromeOptions.addArguments('--user-data-dir=C:/Users/mvpru/nnbitcoin/chrome-profile');

    let driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(chromeOptions)
        .build();

    try {
        await driver.get(`https://twitter.com/${username}`);
        console.log(`Navigated to @${username}.`);

        // Only wait for login if the login file does not exist
        try {
            await fs.access(LOGIN_FILE);
            console.log('Login already completed on this machine.');
        } catch (err) {
            console.log('Not logged in. Please log in now, then press Enter in the terminal to continue...');
            await new Promise(resolve => {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                rl.question('Press Enter after logging in...', () => {
                    rl.close();
                    resolve();
                });
            });
            await fs.writeFile(LOGIN_FILE, 'logged in');
        }

        await driver.wait(until.elementsLocated(By.css('article')), 10000);

        let tweetElements = await driver.findElements(By.css('article'));
        let tweets = [];
        // Start at index 1 to skip the first tweet (likely a pinned tweet)
        for (let i = 1; i < Math.min(count + 1, tweetElements.length); i++) {
            try {
                let tweet = tweetElements[i];
                let tweetText = await tweet.findElement(By.css('div[lang]')).getText();
                let tweetLinkElement = await tweet.findElement(By.css('a[href*="/status/"]'));
                let tweetLink = await tweetLinkElement.getAttribute('href');
                tweets.push({ username: `@${username}`, text: tweetText, link: tweetLink });
            } catch (tweetError) {
                console.error(`Error processing a tweet for @${username}:`, tweetError);
            }
        }

        return tweets;
    } catch (error) {
        console.error(`Error fetching tweets for @${username}:`, error);
        return [];
    } finally {
        await driver.quit();
    }
}

async function fetchTweets() {
    const accounts = ['saylor', 'bitcoinmagazine', 'BitcoinPierre'];
    let allTweets = [];

    for (const account of accounts) {
        try {
            const tweets = await getTweets(account, 5);
            allTweets = allTweets.concat(tweets);
        } catch (error) {
            console.error(`Error fetching tweets for ${account}:`, error);
            // Continue with other accounts even if one fails
        }
    }

    const tweetText = allTweets.map(tweet => `${tweet.username}: ${tweet.text} (Link: ${tweet.link})`).join('\n\n');
    await fs.writeFile('tweets.txt', tweetText);
    console.log('Tweets saved to tweets.txt');

    return allTweets;
}

async function getExistingArticles(articlesDir) {
    const existingArticles = new Map();
    try {
        const files = await fs.readdir(articlesDir);
        for (const file of files) {
            if (file.endsWith('.html')) {
                const slug = file.replace('.html', '');
                existingArticles.set(slug, true);
            }
        }
    } catch (error) {
        console.error('Error reading existing articles:', error);
    }
    return existingArticles;
}

async function fetchArticlesAndPodcasts() {
    const feeds = [
        { url: 'https://cointelegraph.com/rss/tag/bitcoin', type: 'article', category: 'news' },
        { url: 'https://bitcoinmagazine.com/.rss/full/', type: 'article', category: 'news' },
        { url: 'https://feeds.libsyn.com/219386/rss', type: 'podcast', category: 'in-depth' },
        { url: 'https://anchor.fm/s/7d083a4/podcast/rss', type: 'podcast', category: 'in-depth' },
        { url: 'https://feeds.simplecast.com/Z1tu2Hds', type: 'podcast', category: 'in-depth' },
        { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCtOV5M-T3GcsJAq8QKaf0lg', type: 'video', category: 'in-depth' },
        { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJWCJCWOxBYSi5DhCieLOLQ', type: 'video', category: 'in-depth' },
        { url: 'https://nakamotoinstitute.org/feed/', type: 'article', category: 'in-depth' },
        { url: 'https://www.lynalden.com/feed/', type: 'article', category: 'in-depth' },
        { url: 'https://vijayboyapati.medium.com/feed', type: 'article', category: 'in-depth' },
        { url: 'https://bitcoinops.org/en/newsletters/index.xml', type: 'article', category: 'in-depth' },
        { url: 'https://example.com/bitcoin-standard-podcast.rss', type: 'podcast', category: 'in-depth' }
    ];
    const articlesDir = path.join(__dirname, 'public', 'articles');
    const indexPath = path.join(__dirname, 'public', 'index.html');
    await fs.mkdir(articlesDir, { recursive: true });

    // Get existing articles cache
    const existingArticles = await getExistingArticles(articlesDir);

    const bitcoinPrice = await fetchBitcoinPrice();
    // Comment out tweet fetching
    // const allTweets = await fetchTweets();

    const bitcoinKeywords = ['bitcoin', 'btc'];
    const altcoinKeywords = ['ethereum', 'eth', 'ripple', 'xrp', 'cardano', 'ada', 'litecoin', 'ltc', 'binance', 'bnb', 'solana', 'sol', 'polkadot', 'dot', 'dogecoin', 'doge'];
    const technicalAnalysisKeywords = ['technical analysis', 'chart', 'indicator', 'moving average', 'rsi', 'macd', 'bollinger', 'fibonacci', 'support', 'resistance', 'trendline'];

    const allItems = [];

    for (const feed of feeds) {
        try {
            const feedData = await parser.parseURL(feed.url);
            console.log(`Fetched ${feedData.items.length} items from ${feedData.title || feed.url}`);

            for (const item of feedData.items) {
                const title = (item.title || '').toLowerCase();
                const excerpt = (item.contentSnippet || item.content || item.description || '').toLowerCase();
                const slug = title.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

                // Skip if article already exists
                if (existingArticles.has(slug)) {
                    console.log(`Skipping existing article: ${slug}`);
                    
                    // Add to allItems so it still appears in the index
                    allItems.push({
                        slug,
                        title: item.title,
                        excerpt: item.contentSnippet || item.content || item.description || 'No excerpt available',
                        source: feedData.title || 'Unknown Source',
                        date: item.pubDate || new Date().toISOString().split('T')[0],
                        dateObj: item.pubDate ? new Date(item.pubDate) : new Date(),
                        author: item.creator || 'Unknown Author',
                        category: feed.category,
                        type: feed.type,
                        link: item.link
                    });
                    continue;
                }

                let includeItem = false;

                if (feed.type === 'podcast') {
                    includeItem = true;
                } else {
                    const isBitcoinRelated = bitcoinKeywords.some(keyword => title.includes(keyword) || excerpt.includes(keyword));
                    const hasAltcoins = altcoinKeywords.some(keyword => title.includes(keyword) || excerpt.includes(keyword));
                    const hasTechnicalAnalysis = technicalAnalysisKeywords.some(keyword => title.includes(keyword) || excerpt.includes(keyword));
                    includeItem = isBitcoinRelated && !hasAltcoins && !hasTechnicalAnalysis;
                }

                if (includeItem) {
                    const itemHtml = generateItemHtml(item, feed.type, feedData.title, item.link, bitcoinPrice);
                    await fs.writeFile(path.join(articlesDir, `${slug}.html`), itemHtml);
                    console.log(`Generated ${feed.type}: ${slug}.html`);

                    allItems.push({
                        slug,
                        title: item.title,
                        excerpt: item.contentSnippet || item.content || item.description || 'No excerpt available',
                        source: feedData.title || 'Unknown Source',
                        date: item.pubDate || new Date().toISOString().split('T')[0],
                        dateObj: item.pubDate ? new Date(item.pubDate) : new Date(),
                        author: item.creator || 'Unknown Author',
                        category: feed.category,
                        type: feed.type,
                        link: item.link
                    });
                }
            }
        } catch (error) {
            console.error(`Error fetching feed ${feed.url}:`, error);
        }
    }

    allItems.sort((a, b) => b.dateObj - a.dateObj);

    const newsItems = allItems.filter(item => item.category === 'news');
    const inDepthItems = allItems.filter(item => item.category === 'in-depth');

    const indexHtml = generateIndexHtml(newsItems, inDepthItems, [], bitcoinPrice); // Pass empty array instead of allTweets
    await fs.writeFile(indexPath, indexHtml);
    console.log(`Generated index.html with ${newsItems.length} news and ${inDepthItems.length} in-depth items`);
}

function generateItemHtml(item, type, source, link, bitcoinPrice) {
    let content, actionText;
    if (type === 'podcast' && item.enclosure?.url) {
        content = `<audio controls style="width: 100%; margin: 20px 0;"><source src="${item.enclosure.url}" type="audio/mpeg"></audio>`;
        actionText = 'Listen to Original';
    } else if (type === 'video' && item.link) {
        content = `<p><a href="${item.link}" target="_blank" style="color: #ff9800; text-decoration: none;">Watch Video</a></p>`;
        actionText = 'Watch Original';
    } else {
        content = `<p style="font-size: 14px; color: #ddd; margin: 0 0 10px;">${item.contentSnippet || item.content || 'No content available'}</p>`;
        actionText = 'Read Original';
    }

    const badge = type === 'podcast' ? '(A)' : type === 'video' ? '▶' : '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>nonoise₿itcoin - ${item.title}</title>
    <meta name="description" content="${item.contentSnippet ? item.contentSnippet.slice(0, 150) : 'Bitcoin content'}">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&family=Roboto&display=swap" rel="stylesheet">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ff9800'><text x='50%' y='50%' font-size='20' text-anchor='middle' dominant-baseline='middle'>₿</text></svg>" type="image/svg+xml">
    <style>
        body { font-family: 'Roboto', sans-serif; background-color: #121212; color: #ddd; margin: 0; padding: 0; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        header { display: flex; justify-content: space-between; align-items: center; background-color: #1f1f1f; padding: 10px 20px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); }
        header h1 { font-family: 'Montserrat', sans-serif; font-size: 24px; font-weight: 700; margin: 0; color: #fff; }
        .price-ticker { font-size: 18px; font-weight: bold; color: #ff9800; }
        .article-content { background-color: #1f1f1f; padding: 15px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); border-radius: 5px; }
        .article-content h2 { font-family: 'Montserrat', sans-serif; font-size: 24px; color: #fff; margin-bottom: 20px; display: inline; }
        .badge { display: inline-block; width: 20px; height: 20px; line-height: 20px; text-align: center; background-color: #333; color: #ff9800; font-size: 12px; border-radius: 50%; margin-left: 10px; vertical-align: middle; }
        .meta { font-size: 12px; margin-top: 10px; }
        .meta-source, .meta-author { color: #ff9800; }
        .meta-date { color: #aaa; }
        .meta span { margin-right: 5px; }
        .back-link, .source-link { display: inline-block; margin-top: 20px; color: #ff9800; text-decoration: none; font-size: 14px; margin-right: 20px; }
        .back-link:hover, .source-link:hover { text-decoration: underline; }
        footer { text-align: center; margin-top: 20px; font-size: 12px; color: #aaa; padding: 10px 0; border-top: 1px solid #333; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>nonoise₿itcoin</h1>
            <div class="price-ticker">BTC: ${bitcoinPrice}</div>
        </header>
        <div class="article-content">
            <h2>${item.title}</h2>
            ${badge ? `<span class="badge">${badge}</span>` : ''}
            ${content}
            <div class="meta">
                <span class="meta-source">${source || 'Unknown Source'}</span> |
                <span class="meta-date">${item.pubDate || new Date().toISOString().split('T')[0]}</span>
                ${item.author !== 'Unknown Author' ? `| <span class="meta-author">By ${item.author}</span>` : ''}
            </div>
            ${link ? `<a href="${link}" target="_blank" class="source-link">${actionText}</a>` : ''}
            <a href="/" class="back-link">← Back to Home</a>
        </div>
        <footer>
            <p>© 2023 nonoise₿itcoin</p>
        </footer>
    </div>
</body>
</html>
    `;
}

function generateIndexHtml(newsItems, inDepthItems, allTweets, bitcoinPrice) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>nonoise₿itcoin</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&family=Roboto&display=swap" rel="stylesheet">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ff9800'><text x='50%' y='50%' font-size='20' text-anchor='middle' dominant-baseline='middle'>₿</text></svg>" type="image/svg+xml">
    <style>
        body { font-family: 'Roboto', sans-serif; background-color: #121212; color: #ddd; margin: 0; padding: 0; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        header { display: flex; justify-content: space-between; align-items: center; background-color: #1f1f1f; padding: 10px 20px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); }
        header h1 { font-family: 'Montserrat', sans-serif; font-size: 24px; font-weight: 700; margin: 0; color: #fff; }
        .price-ticker { font-size: 18px; font-weight: bold; color: #ff9800; }
        main { display: flex; gap: 20px; margin-top: 20px; }
        .column-left { width: 25%; }
        .column-middle { width: 50%; }
        /* Updated tweet column: now scrolls like the other columns */
        .column-right { width: 25%; background-color: #1f1f1f; padding: 15px; border-radius: 5px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); }
        h2 { font-family: 'Montserrat', sans-serif; font-size: 22px; font-weight: 700; margin-bottom: 10px; background: linear-gradient(to right, #ff9800 0%, #fff 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
        article { background-color: #1f1f1f; padding: 15px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); border-radius: 5px; }
        article:hover { border-left: 2px solid #ff9800; padding-left: 13px; }
        article h3 { font-family: 'Montserrat', sans-serif; font-size: 18px; margin: 0 0 10px; color: #ff9800; display: inline; }
        .badge { display: inline-block; width: 20px; height: 20px; line-height: 20px; text-align: center; background-color: #333; color: #ff9800; font-size: 12px; border-radius: 50%; margin-left: 10px; vertical-align: middle; }
        article h3 a { text-decoration: none; color: #ff9800; }
        article h3 a:hover { text-decoration: underline; }
        article p { font-size: 14px; color: #ddd; margin: 0 0 10px; }
        .meta { font-size: 12px; margin-top: 10px; }
        .meta-source, .meta-author { color: #ff9800; }
        .meta-date { color: #aaa; }
        .meta span { margin-right: 5px; }
        .hidden { display: none; }
        button { background-color: #ff9800; color: #fff; border: none; padding: 10px 20px; cursor: pointer; font-size: 14px; font-family: 'Roboto', sans-serif; border-radius: 5px; margin-top: 10px; transition: background-color 0.3s; }
        button:hover { background-color: #e68900; }
        .tweet { margin-bottom: 15px; }
        .tweet-username { color: #ff9800; font-size: 14px; font-weight: bold; }
        .tweet-username a { color: #ff9800; text-decoration: none; }
        .tweet-username a:hover { text-decoration: underline; }
        .tweet-text { color: #aaa; font-size: 12px; }
        footer { text-align: center; margin-top: 20px; font-size: 12px; color: #aaa; padding: 10px 0; border-top: 1px solid #333; }
        @media (max-width: 768px) { main { flex-direction: column; } .column-left, .column-middle, .column-right { width: 100%; } }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>nonoise₿itcoin</h1>
            <div class="price-ticker">BTC: ${bitcoinPrice}</div>
        </header>
        <main>
            <div class="column-left">
                <h2>Latest News</h2>
                ${newsItems.map((item, index) => `
                    <article${index >= 3 ? ' class="hidden"' : ''}>
                        <h3><a href="/articles/${item.slug}.html">${item.title}</a>${item.type === 'podcast' ? '<span class="badge">(A)</span>' : item.type === 'video' ? '<span class="badge">▶</span>' : ''}</h3>
                        ${item.excerpt !== 'No excerpt available' ? `<p>${item.excerpt.slice(0, 100) + '...'}</p>` : ''}
                        <div class="meta">
                            <span class="meta-source">${item.source}</span> |
                            <span class="meta-date">${item.date}</span>
                            ${item.author !== 'Unknown Author' ? `| <span class="meta-author">By ${item.author}</span>` : ''}
                        </div>
                    </article>
                `).join('')}
            </div>
            <div class="column-middle">
                <h2>In-Depth Content</h2>
                ${inDepthItems.map((item, index) => `
                    <article${index >= 3 ? ' class="hidden"' : ''}>
                        <h3><a href="/articles/${item.slug}.html">${item.title}</a>${item.type === 'podcast' ? '<span class="badge">(A)</span>' : item.type === 'video' ? '<span class="badge">▶</span>' : ''}</h3>
                        ${item.excerpt !== 'No excerpt available' ? `<p>${item.excerpt.slice(0, 100) + '...'}</p>` : ''}
                        <div class="meta">
                            <span class="meta-source">${item.source}</span> |
                            <span class="meta-date">${item.date}</span>
                            ${item.author !== 'Unknown Author' ? `| <span class="meta-author">By ${item.author}</span>` : ''}
                        </div>
                    </article>
                `).join('')}
            </div>
            <!-- Comment out tweet column
            <div class="column-right">
                <h2>Tweets</h2>
                ${allTweets.map(tweet => `
                    <div class="tweet">
                        <div class="tweet-username"><a href="${tweet.link}" target="_blank">${tweet.username}</a></div>
                        <div class="tweet-text">${tweet.text}</div>
                    </div>
                `).join('')}
            </div>
            -->
        </main>
        <button id="show-more">Show More</button>
        <footer>
            <p>© 2023 nonoise₿itcoin | Last updated: ${new Date().toLocaleString()}</p>
        </footer>
    </div>
    <script>
        document.getElementById('show-more').addEventListener('click', function() {
            document.querySelectorAll('.hidden').forEach(function(article) {
                article.classList.remove('hidden');
            });
            this.style.display = 'none';
        });
    </script>
</body>
</html>
    `;
}

fetchArticlesAndPodcasts();
