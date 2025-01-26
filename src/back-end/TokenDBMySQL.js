const mysql = require('mysql2/promise');
const axios = require('axios');
const puppeteer = require('puppeteer');
require('dotenv').config();
const algosdk = require('algosdk');
const cheerio = require('cheerio');
// const {getConnection} = require('./db');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

async function createTable() {
    const connection = await pool.getConnection();
    try {
        await connection.execute('CREATE TABLE TempTokens (address VARCHAR(42) PRIMARY KEY, name VARCHAR(255), symbol VARCHAR(255), decimals INT, chain VARCHAR(255), price DECIMAL(38,18), logoURL VARCHAR(1024))');
        // const [rows] = await connection.execute(`
        //     SELECT COLUMN_NAME, DATA_TYPE 
        //     FROM INFORMATION_SCHEMA.COLUMNS 
        //     WHERE TABLE_NAME = 'TempTokens' AND TABLE_SCHEMA = DATABASE()
        // `);

        // console.log('Columns and their data types:');
        // rows.forEach(row => {
        //     console.log(`Column: ${row.COLUMN_NAME}, Data Type: ${row.DATA_TYPE}`);
        // });
        console.log(rows);
        console.log('Table created successfully!');
    } catch (error) {
        console.error('Error creating table:', error);
    } finally {
        connection.release();
    }
}

// async function createTable() {
//     let connection;

//     try {
//         // Get the database connection
//         connection = await getConnection();

//         // SQL query to create the TempTokens table
//         const createTableQuery = `
//             CREATE TABLE TempTokens (
//                 address VARCHAR(42) PRIMARY KEY, 
//                 name VARCHAR(255), 
//                 symbol VARCHAR(255), 
//                 decimals INT, 
//                 chain VARCHAR(255), 
//                 price DECIMAL(38,18), 
//                 logoURL VARCHAR(1024)
//             )
//         `;

//         // Execute the query
//         await connection.query(createTableQuery);

//         console.log('Table created successfully!');
//     } catch (error) {
//         console.error('Error creating table:', error);
//     } finally {
//         if (connection) {
//             connection.release();  // Ensure the connection is released
//         }
//     }
// }

async function fetchPrices() {
    const connection = await pool.getConnection();
    try {
        const [tokens] = await connection.execute('SELECT chain, address FROM TempTokens');
        if (tokens.length === 0) return;

        const addressBatches = [];
        const batchSize = 100;

        for (let i = 0; i < tokens.length; i += batchSize) {
            addressBatches.push(tokens.slice(i, i + batchSize));
        }

        for (const batch of addressBatches) {
            const coinsParam = batch.map(token => `${token.chain}:${token.address}`).join(',');
            console.log(coinsParam);

            const priceResponse = await axios.get(`https://coins.llama.fi/prices/current/${coinsParam}`);
            const prices = priceResponse.data.coins;

            const updatePromises = [];
            for (const token of batch) {
                const priceData = prices[`${token.chain}:${token.address}`];
                if (priceData) {
                    updatePromises.push(
                        connection.execute('UPDATE TempTokens SET price = ? WHERE address = ?', [priceData.price ? priceData.price : null, token.address])
                    );
                    updatePromises.push(
                        connection.execute('UPDATE TempTokens SET decimals = ? WHERE address = ?', [priceData.decimals ? priceData.decimals : 18, token.address])
                    );
                }
            }

            await Promise.all(updatePromises);
        }

        console.log('Token prices updated successfully!');
    } catch (error) {
        console.error('Error updating token prices:', error);
    } finally {
        connection.release();
    }
}

// fetchPrices();

async function fetchData() {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query('SELECT * FROM TempTokens');
        console.log(rows);
    } catch(error) {
        console.error(error);
    } finally {
        connection.release();
    }
}


async function fetchAlgorandAssetDetails(assetId) {
    const mainnetClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);

    try {
        const asset = await mainnetClient.lookupAssetByID(assetId).do();

        // console.log('Asset Details:', asset);

        const assetDetails = {
            address: assetId,
            name: asset.asset.params.name,
            symbol: asset.asset.params.unitName,
            decimals: asset.asset.params.decimals || 0,
            chain: 'algorand',
            logoURL: null
        };

        return assetDetails;
    } catch (error) {
        console.error(`Error fetching asset details for asset ID ${assetId}:`, error);
        return null;
    }
}

async function algoAssetIds() {
    const connection = await pool.getConnection();
    try {
        const query = 'INSERT INTO TempTokens (address, name, symbol, decimals, chain, logoURL, price) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const assetIds = [
            2751733,
            287867876, 
            137020565,
            657291910,
            887407002,
            312769,
            1138500612,
            1237529510,
            283820866,
            1821328783,
            27165954
        ];
        const assetDetailsArray = await Promise.all(assetIds.map(async (assetId) => {
            const assetDetails = await fetchAlgorandAssetDetails(assetId);
            return assetDetails;
        }));

        const price = null;
        for (const asset of assetDetailsArray) {
            await connection.execute(query, [asset.address, asset.name, asset.symbol, asset.decimals, asset.chain, asset.logoURL, price]);
        }

        console.log('Asset Details Array:', assetDetailsArray);
        return assetDetailsArray;
    } catch (error) {
        console.error('Error fetching asset details:', error);
        return [];
    } finally {
        connection.release();
    }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeCoinGeckoTokens() {
    const tokenMap = {};
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    for (let pageNum = 1; pageNum <= 57; pageNum++) {
        const url = `https://www.coingecko.com/?page=${pageNum}&items=300`;
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.66 Safari/537.36');
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            const content = await page.content();
            const $ = cheerio.load(content);

            console.log("Scraping page ", pageNum);
            const rows = $('table.sortable tbody tr');
            console.log(`Found ${rows.length} rows on page ${pageNum}`);

            rows.each((i, element) => {
                const logoUrl = $(element).find('td:nth-child(3) a img').attr('src');
                const symbol = $(element).find('td:nth-child(3) div div div').text().trim().toLowerCase();
                console.log({ symbol, logoUrl });
                if (symbol && logoUrl) {
                    tokenMap[symbol] = logoUrl;
                }
            });

            console.log(`Scraped page ${pageNum}`);
            await delay(1000); // 1 second delay to avoid rate limit
        } catch (error) {
            console.error(`Error scraping page ${pageNum}:`, error.message);
            await delay(60000); // Wait for 1 minute before retrying
        }
    }

    await browser.close();
    return tokenMap;
}

// Function to fetch and update token logos
async function fetchAndUpdateTokenLogos() {
    const connection = await pool.getConnection();

    try {
        // Scrape the CoinGecko page to get the token symbols and logo URLs
        const tokenMap = await scrapeCoinGeckoTokens();

        // Fetch the tokens from your database
        const [rows] = await connection.execute('SELECT address, symbol FROM TempTokens');
        const dbTokens = rows;

        // Match the tokens and update the database with the image URLs
        for (const dbToken of dbTokens) {
            const logoUrl = tokenMap[dbToken.symbol.toLowerCase()];
            if (logoUrl) {
                try {
                    await connection.execute('UPDATE TempTokens SET logoURL = ? WHERE address = ?', [logoUrl, dbToken.address]);
                    console.log("Updated logo for token", dbToken.symbol);
                } catch (error) {
                    console.error(`Error updating logo for token ${dbToken.symbol}:`, error.message);
                    continue; // Skip to the next iteration
                }
            }
        }

        console.log('Token logos updated successfully');
    } catch (error) {
        console.error('Error fetching or updating token logos:', error);
    } finally {
        connection.release();
    }
}

// Call the function to fetch and update token logos
fetchAndUpdateTokenLogos();