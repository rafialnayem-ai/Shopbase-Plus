const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json());

const cache = new Map();

const publicVapidKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeZpfiqQG3UvQY3T3rAqkH5Y740WMBv2g6_h-O-UGE54_6Q51l30';
const privateVapidKey = '4k7yP0A7yN-_dC4_e-9hQ8rN6N-bXJvM9lK3T7B4v30';
webpush.setVapidDetails('mailto:admin@localhost.com', publicVapidKey, privateVapidKey);

let subscriptions = [];
app.post('/subscribe', (req, res) => {
    subscriptions.push(req.body);
    res.status(201).json({});
});

// Render root URL - shows server status
app.get('/', (req, res) => {
    res.send('server is on');
});

// --- Auto Login & Cookie Fetcher ---
let authCookie = '';
let csrfToken = '';
let lastLoginTime = 0;

async function loginAndGetCookies() {
    const now = Date.now();
    // Cache tokens for 1 hour (3600000 ms)
    if (authCookie && csrfToken && (now - lastLoginTime < 3600000)) {
        return { cookie: authCookie, token: csrfToken };
    }

    try {
        console.log("Fetching CSRF token...");
        const loginPage = await axios.get('https://shopbasebd.com/store/login', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        let initialCookie = loginPage.headers['set-cookie'] ? loginPage.headers['set-cookie'].map(c => c.split(';')[0]).join('; ') : '';
        const $ = cheerio.load(loginPage.data);
        csrfToken = $('input[name="_token"]').val() || '';

        console.log("Logging in automatically...");
        const loginParams = new URLSearchParams();
        loginParams.append('username', '01994887927');
        loginParams.append('password', 'Nasir@61983#');
        loginParams.append('_token', csrfToken);

        const loginReq = await axios.post('https://shopbasebd.com/store/logincheck', loginParams.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Cookie': initialCookie,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://shopbasebd.com/store/login'
            }
        });

        if (loginReq.headers['set-cookie']) {
            authCookie = loginReq.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        } else {
            authCookie = initialCookie;
        }

        lastLoginTime = Date.now();
        console.log("Login Successful! Ready to fetch data.");
        return { cookie: authCookie, token: csrfToken };
    } catch (error) {
        console.error("Auto-login failed:", error.message);
        return { cookie: authCookie, token: csrfToken };
    }
}
// -----------------------------------

// API to fetch the latest products
app.get('/api/products', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const category = req.query.category || '2';
        const cacheKey = `products_${category}_${page}`;
        
        if (cache.has(cacheKey) && (Date.now() - cache.get(cacheKey).time < 300000)) {
            return res.json({ products: cache.get(cacheKey).data });
        }

        const { cookie } = await loginAndGetCookies();
        const url = `https://shopbasebd.com/store/new-post/${category}/all/${page}`;
        
        let { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Cookie': cookie
            }
        });
        
        let $ = cheerio.load(data);

        // Fix for Next-Day Loading: Force re-login if session expired
        if ($('input[name="_token"]').length > 0 && data.includes('login')) {
            lastLoginTime = 0;
            const newAuth = await loginAndGetCookies();
            const retry = await axios.get(url, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Cookie': newAuth.cookie
                }
            });
            data = retry.data;
            $ = cheerio.load(data);
        }

        const products = [];

        $('.card.mb-3').each((i, el) => {
            const postId = $(el).find('.copy-description-button').attr('data-id');
            const title = $(el).find('.productName.mt-0').text().trim();
            
            const priceText = $(el).find('table tr td').first().find('button').text().trim();
            let price = "N/A";
            if (priceText.includes(':')) {
                price = priceText.split(':')[1].trim();
            }

            const description = $(el).find('.read-more-target').html();

            const images = [];
            if (postId) {
                $(el).find(`a.img-download-btn-${postId}`).each((j, imgEl) => {
                    images.push($(imgEl).attr('href'));
                });
            }

            if (postId && title) {
                products.push({ postId, title, price, description, images });
            }
        });

        cache.set(cacheKey, { data: products, time: Date.now() });
        res.json({ products });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// API to download images directly to bypass CORS
app.get('/api/download', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('No URL provided');
    
    try {
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'stream'
        });
        
        const filename = imageUrl.split('/').pop() || 'image.jpg';
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        response.data.pipe(res);
    } catch (error) {
        console.error('Image download error:', error.message);
        res.status(500).send('Failed to download image');
    }
});

// API to fetch specific product details (SKU & Suggested Price)
app.get('/api/details/:postId', async (req, res) => {
    try {
        const { cookie } = await loginAndGetCookies();
        const headers = { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
            'Cookie': cookie
        };

        const postUrl = `https://shopbasebd.com/store/new-post/view/${req.params.postId}`;
        const { data: postData } = await axios.get(postUrl, { headers });
        
        const $post = cheerio.load(postData);
        const productId = $post('.favorite').attr('data-id') || 
                          $post('input[name="product_id"]').val() ||
                          $post('a[href*="/store/products/details/"]').first().attr('href')?.split('/').pop();

        if (productId) {
            const detailsUrl = `https://shopbasebd.com/store/products/details/${productId}`;
            const { data: detailsData } = await axios.get(detailsUrl, { headers });
            const $ = cheerio.load(detailsData);

            let skuText = "SKU: N/A";
            let suggestedPrice = "";
            
            // Unicode match for Bengali text to strictly avoid Bengali fonts in source code
            const suggestedPriceMatch = '\\u09B8\\u09BE\\u099C\\u09C7\\u09B8\\u09CD\\u099F\\u09C7\\u09A1 \\u09AC\\u09BF\\u0995\\u09CD\\u09B0\\u09DF \\u09AE\\u09C2\\u09B2\\u09CD\\u09AF';
            const stockAvailableMatch = '\\u0986\\u099B\\u09C7';

            $('p').each((i, el) => {
                const text = $(el).text().trim();
                if (text.includes('SKU:')) {
                    skuText = text;
                }
                if (text.includes(JSON.parse(`"${suggestedPriceMatch}"`))) {
                    suggestedPrice = text;
                }
            });

            let isStockAvailable = false;
            $('button').each((i, el) => {
                if ($(el).text().includes(JSON.parse(`"${stockAvailableMatch}"`))) {
                    isStockAvailable = true;
                }
            });

            let rating = 0;
            const ratingElem = $('.rating');
            if (ratingElem.length) {
                rating = ratingElem.find('.fa.fa-star').length;
            }

            res.json({ sku: skuText, suggestedPrice, isStockAvailable, rating });
        } else {
            res.json({ sku: "SKU: N/A", suggestedPrice: "" });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch details' });
    }
});

// NEW API: Search Products by Name or SKU
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.json({ products: [] });

        const { cookie, token } = await loginAndGetCookies();
        
        const isSku = !isNaN(query);
        const url = isSku ? 'https://shopbasebd.com/store/products/search/sku' : 'https://shopbasebd.com/store/products/search/name';
        
        // Manual multipart/form-data payload
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const paramName = isSku ? 'sku' : 'name';
        
        let postData = `--${boundary}\r\n`;
        postData += `Content-Disposition: form-data; name="_token"\r\n\r\n${token}\r\n`;
        postData += `--${boundary}\r\n`;
        postData += `Content-Disposition: form-data; name="${paramName}"\r\n\r\n${query}\r\n`;
        postData += `--${boundary}--\r\n`;

        const { data } = await axios.post(url, postData, {
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Cookie': cookie
            }
        });

        const products = [];
        if (data && data.data && data.data.length > 0) {
            data.data.forEach(item => {
                products.push({
                    isSearch: true,
                    pid: item.pid,
                    title: item.name,
                    price: item.sprice,
                    description: '', 
                    images: [`https://shopbasebd.com/public/uploads/shop/products/${item.img_sm}`]
                });
            });
        }
        res.json({ products });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// NEW API: Fetch Full Details for Search Results
app.get('/api/product-details/:pid', async (req, res) => {
    try {
        const { cookie } = await loginAndGetCookies();
        const detailsUrl = `https://shopbasebd.com/store/products/details/${req.params.pid}`;
        const { data: detailsData } = await axios.get(detailsUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Cookie': cookie
            }
        });
        const $ = cheerio.load(detailsData);

        const skuElem = $('p:contains("SKU:")');
        const skuText = skuElem.text().trim() || "SKU: N/A";
        const suggestedPrice = skuElem.prev('p').text().trim();
        const description = $('#descriptionCopy').html() || '';
        
        let isStockAvailable = false;
        const stockAvailableMatch = '\\u0986\\u099B\\u09C7';
        $('button').each((i, el) => {
            if ($(el).text().includes(JSON.parse(`"${stockAvailableMatch}"`))) {
                isStockAvailable = true;
            }
        });

        let rating = 0;
        const ratingElem = $('.rating');
        if (ratingElem.length) {
            rating = ratingElem.find('.fa.fa-star').length;
        }

        const images = [];
        $('a.btn-outline-success[download]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && !images.includes(href)) images.push(href);
        });

        res.json({ sku: skuText, suggestedPrice, description, images, isStockAvailable, rating });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch product details' });
    }
});

let lastCheckedProductId = null;
setInterval(async () => {
    if (subscriptions.length === 0) return;
    try {
        const { cookie } = await loginAndGetCookies();
        const { data } = await axios.get('https://shopbasebd.com/store/new-post/2/all/1', {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie }
        });
        const $ = cheerio.load(data);
        const latestPostId = $('.card.mb-3').first().find('.copy-description-button').attr('data-id');
        
        if (latestPostId && lastCheckedProductId && latestPostId !== lastCheckedProductId) {
            const payload = JSON.stringify({ title: 'New Products Uploaded!' });
            subscriptions.forEach(sub => webpush.sendNotification(sub, payload).catch(err => console.error(err)));
        }
        if (latestPostId) lastCheckedProductId = latestPostId;
    } catch (e) {
        console.error(e.message);
    }
}, 300000); // Checks every 5 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));