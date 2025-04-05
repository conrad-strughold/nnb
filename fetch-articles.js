const fs = require('fs').promises;
const path = require('path');
const Parser = require('rss-parser');
const parser = new Parser();
const axios = require('axios');
const cheerio = require('cheerio');

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

// Scrape Cointelegraph article content
async function scrapeCointelegraphArticle(url) {
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const content = $('div.post-content').html();
        if (!content) return '<p>No content available</p>';
        const $content = cheerio.load(content);
        $content('template, .post-content__disclaimer').remove();
        return $content.html();
    } catch (error) {
        console.error(`Error scraping Cointelegraph ${url}:`, error);
        return '<p>Error fetching article content</p>';
    }
}

// Scrape Bitcoin Magazine article content
async function scrapeBitcoinMagazineArticle(url) {
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const $content = $('div.tdb-block-inner.td-fix-index');
        if (!$content.length) return '<p>No content available</p>';
        $content.find('#bsf_rt_marker, .molongui-post-byline, [class*="bitco-"], style, script').remove();
        let articleContent = '';
        $content.find('p').each((i, elem) => {
            const paragraphText = $(elem).html();
            if (paragraphText && paragraphText.trim()) {
                articleContent += `<p style="font-size: 14px; color: #ddd; margin: 0 0 10px;">${paragraphText}</p>`;
            }
        });
        return articleContent || '<p>No content available</p>';
    } catch (error) {
        console.error(`Error scraping Bitcoin Magazine ${url}:`, error);
        return '<p>Error fetching article content</p>';
    }
}

// Scrape Bitcoin Stack Exchange question and answers
async function scrapeBitcoinStackExchange(url) {
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const questionBody = $('.s-prose.js-post-body').first().html();
        if (!questionBody) return '<p>No content available</p>';
        const $question = cheerio.load(questionBody);
        $question('script, style').remove();
        let answersContent = '';
        const answers = $('#answers .answer .s-prose.js-post-body');
        if (answers.length > 0) {
            answers.each((i, elem) => {
                const answerText = $(elem).html();
                if (answerText && answerText.trim()) {
                    answersContent += `
                        <h3 style="font-size: 20px; color: #ddd; margin: 15px 0;">Answer ${i + 1}</h3>
                        <div style="font-size: 14px; color: #ddd; margin: 0 0 20px;">${answerText}</div>
                    `;
                }
            });
        } else {
            answersContent = '<p style="font-size: 14px; color: #ddd; margin: 0 0 10px;">No answers available yet.</p>';
        }
        return `
            <h3 style="font-size: 20px; color: #ddd; margin: 15px 0;">Question</h3>
            <div style="font-size: 14px; color: #ddd; margin: 0 0 20px;">${$question.html()}</div>
            ${answersContent}
        `;
    } catch (error) {
        console.error(`Error scraping Bitcoin Stack Exchange ${url}:`, error);
        return '<p>Error fetching question content</p>';
    }
}

// Scrape a single Reddit post
async function scrapeSingleRedditPost(url) {
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const title = $('h1[id^="post-title-t3_"]').text().trim() || $('shreddit-post').attr('post-title') || 'No title available';
        const postType = $('shreddit-post').attr('post-type');
        const imageUrl = $('shreddit-post').attr('content-href');
        let formattedContent = '';

        if (postType === 'video') {
            // Handle video post
            const player = $('shreddit-player-2');
            const mediaJson = player.attr('packaged-media-json');
            if (mediaJson) {
                const mediaData = JSON.parse(mediaJson);
                const mp4s = mediaData.playbackMp4s.permutations;
                const bestMp4 = mp4s.sort((a, b) => b.source.dimensions.height - a.source.dimensions.height)[0].source.url; // Get highest resolution
                formattedContent = `
                    <h2 style="font-size: 24px; color: #ddd; margin: 20px 0;">${title}</h2>
                    <div style="margin: 0 0 20px;">
                        <video controls style="max-width: 100%; height: auto; border-radius: 8px;">
                            <source src="${bestMp4}" type="video/mp4">
                            Your browser does not support the video tag.
                        </video>
                    </div>
                `;
            } else {
                formattedContent = `
                    <h2 style="font-size: 24px; color: #ddd; margin: 20px 0;">${title}</h2>
                    <div style="font-size: 16px; color: #ddd; margin: 0 0 20px; line-height: 1.5;">Video content unavailable</div>
                `;
            }
        } else if ($('gallery-carousel').length > 0) {
            // Handle multi-image gallery post
            const images = [];
            $('gallery-carousel li figure img.media-lightbox-img').each((i, elem) => {
                const src = $(elem).attr('src') || $(elem).attr('data-lazy-src');
                if (src) images.push(src);
            });
            if (images.length > 0) {
                formattedContent = `
                    <h2 style="font-size: 24px; color: #ddd; margin: 20px 0;">${title}</h2>
                    <div class="carousel" style="margin: 0 0 20px; position: relative; overflow: hidden; max-width: 100%;">
                        <div class="carousel-inner" style="display: flex; transition: transform 0.5s ease;">
                            ${images.map((img, index) => `
                                <div class="carousel-item" style="flex: 0 0 100%; min-width: 100%;">
                                    <img src="${img}" alt="${title} - Image ${index + 1}" style="max-width: 100%; height: auto; border-radius: 8px;">
                                </div>
                            `).join('')}
                        </div>
                        <button class="carousel-prev" style="position: absolute; top: 50%; left: 10px; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: #fff; border: none; padding: 10px; cursor: pointer;">&#10094;</button>
                        <button class="carousel-next" style="position: absolute; top: 50%; right: 10px; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: #fff; border: none; padding: 10px; cursor: pointer;">&#10095;</button>
                    </div>
                    <script>
                        const carousel = document.currentScript.previousElementSibling;
                        const inner = carousel.querySelector('.carousel-inner');
                        const items = carousel.querySelectorAll('.carousel-item');
                        let currentIndex = 0;
                        function updateCarousel() {
                            inner.style.transform = \`translateX(-\${currentIndex * 100}%)\`;
                        }
                        carousel.querySelector('.carousel-prev').addEventListener('click', () => {
                            currentIndex = (currentIndex > 0) ? currentIndex - 1 : items.length - 1;
                            updateCarousel();
                        });
                        carousel.querySelector('.carousel-next').addEventListener('click', () => {
                            currentIndex = (currentIndex < items.length - 1) ? currentIndex + 1 : 0;
                            updateCarousel();
                        });
                    </script>
                `;
            } else {
                formattedContent = `
                    <h2 style="font-size: 24px; color: #ddd; margin: 20px 0;">${title}</h2>
                    <div style="font-size: 16px; color: #ddd; margin: 0 0 20px; line-height: 1.5;">No images available</div>
                `;
            }
        } else if (postType === 'image' && imageUrl) {
            // Handle single image post
            formattedContent = `
                <h2 style="font-size: 24px; color: #ddd; margin: 20px 0;">${title}</h2>
                <div style="margin: 0 0 20px;">
                    <img src="${imageUrl}" alt="${title}" style="max-width: 100%; height: auto; border-radius: 8px;" />
                </div>
            `;
        } else {
            // Handle text post
            const textBody = $('div[id*="-post-rtjson-content"]').html() || '';
            if (textBody) {
                const $textBody = cheerio.load(textBody);
                $textBody('script, style').remove();
                formattedContent = `
                    <h2 style="font-size: 24px; color: #ddd; margin: 20px 0;">${title}</h2>
                    <div style="font-size: 16px; color: #ddd; margin: 0 0 20px; line-height: 1.5;">${$textBody.html().trim()}</div>
                `;
            } else {
                formattedContent = `
                    <h2 style="font-size: 24px; color: #ddd; margin: 20px 0;">${title}</h2>
                    <div style="font-size: 16px; color: #ddd; margin: 0 0 20px; line-height: 1.5;">No text content available</div>
                `;
            }
        }

        formattedContent += `
            <p style="font-size: 14px; color: #ddd; margin: 0 0 20px;">
                <a href="${url}" target="_blank" style="color: #ff9800; text-decoration: none;">View original post on Reddit</a>
            </p>
            <hr style="border: 1px solid #444; margin: 30px 0;" />
        `;
        console.log(`Scraped post: ${title} from ${url}`);
        return formattedContent;
    } catch (error) {
        console.error(`Error scraping Reddit ${url}:`, error);
        return `
            <h2 style="font-size: 24px; color: #ddd; margin: 20px 0;">Error</h2>
            <div style="font-size: 16px; color: #ddd; margin: 0 0 20px; line-height: 1.5;">Failed to fetch content for ${url}</div>
            <hr style="border: 1px solid #444; margin: 30px 0;" />
        `;
    }
}

// Scrape and combine Reddit posts from RSS feed
async function scrapeRedditPosts(bitcoinPrice, feedItems) {
    try {
        const filteredItems = feedItems.filter(item => {
            const title = item.title || '';
            return !title.includes('Bitcoin Newcomers FAQ') && !title.includes('Daily Discussion');
        });
        const postLinks = filteredItems.slice(0, 10).map(item => item.link);

        if (postLinks.length === 0) return '<p>No posts found on r/Bitcoin after filtering</p>';

        const postContents = await Promise.all(postLinks.map(url => scrapeSingleRedditPost(url)));
        const today = 'April 5, 2025';
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>nonoise₿itcoin - r/Bitcoin Posts + ${today}</title>
    <meta name="description" content="Latest posts from r/Bitcoin">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&family=Roboto&display=swap" rel="stylesheet">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ff9800'><text x='50%' y='50%' font-size='20' text-anchor='middle' dominant-baseline='middle'>₿</text></svg>" type="image/svg+xml">
    <style>
        body { font-family: 'Roboto', sans-serif; background-color: #121212; color: #ddd; margin: 0; padding: 0; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        header { display: flex; justify-content: space-between; align-items: center; background-color: #1f1f1f; padding: 10px 20px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); }
        header h1 { font-family: 'Montserrat', sans-serif; font-size: 24px; font-weight: 700; margin: 0; color: #fff; }
        .price-ticker { font-size: 18px; font-weight: bold; color: #ff9800; }
        .article-content { background-color: #1f1f1f; padding: 15px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); border-radius: 5px; }
        .article-content h2 { font-family: 'Montserrat', sans-serif; font-size: 24px; color: #fff; margin-bottom: 20px; }
        .article-content img { max-width: 100%; height: auto; margin: 10px 0; }
        .meta { font-size: 12px; margin-top: 10px; }
        .meta-source { color: #ff9800; }
        .meta-date { color: #aaa; }
        .meta span { margin-right: 5px; }
        .back-link { display: inline-block; margin-top: 20px; color: #ff9800; text-decoration: none; font-size: 14px; }
        .back-link:hover { text-decoration: underline; }
        footer { text-align: center; margin-top: 20px; font-size: 12px; color: #aaa; padding: 10px 0; border-top: 1px solid #333; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>nonoise₿itcoin</h1>
            <div class="price-ticker">BTC: <span id="bitcoin-price">${bitcoinPrice}</span></div>
        </header>
        <div class="article-content">
            <h2>r/Bitcoin Posts + ${today}</h2>
            ${postContents.join('')}
            <div class="meta">
                <span class="meta-source">Reddit r/Bitcoin</span> |
                <span class="meta-date">${today}</span>
            </div>
            <a href="/" class="back-link">← Back to Home</a>
        </div>
        <footer>
            <p>© 2023 nonoise₿itcoin</p>
        </footer>
    </div>
    <script>
        async function updateBitcoinPrice() {
            try {
                const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
                const data = await response.json();
                const price = data.bitcoin.usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
                document.getElementById('bitcoin-price').textContent = price;
            } catch (error) {
                console.error('Error fetching Bitcoin price:', error);
                document.getElementById('bitcoin-price').textContent = 'Error';
            }
        }
        updateBitcoinPrice();
        setInterval(updateBitcoinPrice, 30000);
    </script>
</body>
</html>
        `;
    } catch (error) {
        console.error('Error scraping r/Bitcoin:', error);
        return '<p>Error fetching posts from r/Bitcoin</p>';
    }
}

async function fetchArticlesAndPodcasts() {
    const feeds = [
        { url: 'https://cointelegraph.com/rss/tag/bitcoin', type: 'article', category: 'news', source: 'Cointelegraph' },
        { url: 'https://bitcoinmagazine.com/.rss/full/', type: 'article', category: 'news', source: 'Bitcoin Magazine' },
        { url: 'https://feeds.libsyn.com/219386/rss', type: 'podcast', category: 'in-depth', source: 'Podcast' },
        { url: 'https://bitcoin.stackexchange.com/feeds/hot', type: 'article', category: 'in-depth', source: 'Bitcoin Stack Exchange' },
        { url: 'https://www.reddit.com/r/bitcoin.rss', type: 'article', category: 'in-depth', source: 'Reddit r/Bitcoin' }
    ];
    const articlesDir = path.join(__dirname, 'public', 'articles');
    const indexPath = path.join(__dirname, 'public', 'index.html');
    await fs.mkdir(articlesDir, { recursive: true });

    const existingArticles = await getExistingArticles(articlesDir);
    const bitcoinPrice = await fetchBitcoinPrice();
    const allTweets = [];
    const allItems = [];

    const bitcoinKeywords = ['bitcoin', 'btc'];
    const altcoinKeywords = ['ethereum', 'eth', 'ripple', 'xrp'];
    const technicalAnalysisKeywords = ['technical analysis', 'chart', 'indicator'];

    for (const feed of feeds) {
        try {
            const response = await axios.get(feed.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/rss+xml, text/html',
                    'Referer': feed.url.includes('reddit') ? 'https://www.reddit.com/' : 'https://bitcoin.stackexchange.com/'
                }
            });
            const feedData = await parser.parseString(response.data);
            console.log(`Fetched ${feedData.items.length} items from ${feedData.title || feed.url}`);

            if (feed.source === 'Reddit r/Bitcoin') {
                const fullContent = await scrapeRedditPosts(bitcoinPrice, feedData.items);
                const redditSlug = 'r-bitcoin-posts-april-5-2025';
                if (!existingArticles.has(redditSlug)) {
                    await fs.writeFile(path.join(articlesDir, `${redditSlug}.html`), fullContent);
                    console.log(`Generated combined Reddit posts: ${redditSlug}.html`);
                }
                allItems.push({
                    slug: redditSlug,
                    title: 'r/Bitcoin Posts + April 5, 2025',
                    excerpt: 'Latest posts from r/Bitcoin',
                    source: 'Reddit r/Bitcoin',
                    date: new Date().toISOString().split('T')[0],
                    dateObj: new Date(),
                    author: 'Various',
                    category: feed.category,
                    type: feed.type,
                    link: 'https://www.reddit.com/r/Bitcoin/'
                });
                continue;
            }

            for (const item of feedData.items) {
                const title = (item.title || '').toLowerCase();
                const excerpt = (item.contentSnippet || item.content || item.description || '').toLowerCase();
                const slug = title.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

                if (existingArticles.has(slug)) {
                    console.log(`Skipping existing article: ${slug}`);
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
                if (feed.type === 'podcast' || feed.type === 'video') {
                    includeItem = true;
                } else {
                    const isBitcoinRelated = bitcoinKeywords.some(keyword => title.includes(keyword) || excerpt.includes(keyword));
                    const hasAltcoins = altcoinKeywords.some(keyword => title.includes(keyword) || excerpt.includes(keyword));
                    const hasTechnicalAnalysis = technicalAnalysisKeywords.some(keyword => title.includes(keyword) || excerpt.includes(keyword));
                    includeItem = isBitcoinRelated && !hasAltcoins && !hasTechnicalAnalysis;
                }

                if (includeItem) {
                    let fullContent = '';
                    if (feed.source === 'Cointelegraph' && item.link) {
                        fullContent = await scrapeCointelegraphArticle(item.link);
                    } else if (feed.source === 'Bitcoin Magazine' && item.link) {
                        fullContent = await scrapeBitcoinMagazineArticle(item.link);
                    } else if (feed.source === 'Bitcoin Stack Exchange' && item.link) {
                        fullContent = await scrapeBitcoinStackExchange(item.link);
                    } else {
                        fullContent = `<p style="font-size: 14px; color: #ddd; margin: 0 0 10px;">${item.contentSnippet || item.content || 'No content available'}</p>`;
                    }

                    const itemHtml = generateItemHtml(item, feed.type, feedData.title, item.link, bitcoinPrice, fullContent);
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

            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`Error fetching feed ${feed.url}:`, error.message);
            continue;
        }
    }

    allItems.sort((a, b) => b.dateObj - a.dateObj);
    const newsItems = allItems.filter(item => item.category === 'news');
    const inDepthItems = allItems.filter(item => item.category === 'in-depth');

    const indexHtml = generateIndexHtml(newsItems, inDepthItems, [], bitcoinPrice);
    await fs.writeFile(indexPath, indexHtml);
    console.log(`Generated index.html with ${newsItems.length} news and ${inDepthItems.length} in-depth items`);
}

function generateItemHtml(item, type, source, link, bitcoinPrice, fullContent) {
    let actionText = type === 'podcast' ? 'Listen to Original' : type === 'video' ? 'Watch Original' : 'Read Original';
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
        .article-content h3 { font-family: 'Montserrat', sans-serif; font-size: 20px; color: #ddd; margin: 15px 0; }
        .article-content img { max-width: 100%; height: auto; margin: 10px 0; }
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
            <div class="price-ticker">BTC: <span id="bitcoin-price">${bitcoinPrice}</span></div>
        </header>
        <div class="article-content">
            <h2>${item.title}</h2>
            ${badge ? `<span class="badge">${badge}</span>` : ''}
            ${type === 'podcast' && item.enclosure?.url ? `<audio controls style="width: 100%; margin: 20px 0;"><source src="${item.enclosure.url}" type="audio/mpeg"></audio>` : ''}
            ${type === 'video' && item.link ? `<p><a href="${item.link}" target="_blank" style="color: #ff9800; text-decoration: none;">Watch Video</a></p>` : ''}
            ${fullContent}
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
    <script>
        async function updateBitcoinPrice() {
            try {
                const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
                const data = await response.json();
                const price = data.bitcoin.usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
                document.getElementById('bitcoin-price').textContent = price;
            } catch (error) {
                console.error('Error fetching Bitcoin price:', error);
                document.getElementById('bitcoin-price').textContent = 'Error';
            }
        }
        updateBitcoinPrice();
        setInterval(updateBitcoinPrice, 30000);
    </script>
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
        footer { text-align: center; margin-top: 20px; font-size: 12px; color: #aaa; padding: 10px 0; border-top: 1px solid #333; }
        @media (max-width: 768px) { main { flex-direction: column; } .column-left, .column-middle { width: 100%; } }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>nonoise₿itcoin</h1>
            <div class="price-ticker">BTC: <span id="bitcoin-price">${bitcoinPrice}</span></div>
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
                <h2>Media Hub</h2>
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
        </main>
        <button id="show-more">Show More</button>
        <footer>
            <p>© 2023 nonoise₿itcoin | Last updated: ${new Date().toLocaleString()}</p>
        </footer>
    </div>
    <script>
        async function updateBitcoinPrice() {
            try {
                const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
                const data = await response.json();
                const price = data.bitcoin.usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
                document.getElementById('bitcoin-price').textContent = price;
            } catch (error) {
                console.error('Error fetching Bitcoin price:', error);
                document.getElementById('bitcoin-price').textContent = 'Error';
            }
        }
        updateBitcoinPrice();
        setInterval(updateBitcoinPrice, 30000);

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