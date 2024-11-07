const axios = require('axios');
const cheerio = require('cheerio');
const mysql = require('mysql2/promise'); // For async/await MySQL handling
// const { getConnection } = require('./db');

// Database setup
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 15,
    maxIdle: 10,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});

// Function to scrape tokens from a single URL
async function scrapeExplorerTokens(url) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const tokens = [];

        $('table tbody tr').each((i, element) => {
            const nameSymbolText = $(element).find('td').eq(1).text().trim();
            const cleanText = nameSymbolText.split('\n')[0].trim();
            const match = nameSymbolText.match(/(.+)\s\((.+)\)/);
            // console.log(match);

            if (match) {
                const name = cleanText;
                const symbol = match[2].trim();
                const address = $(element).find('td a').attr('href').replace('/token/', '');
                
                const getBaseUrl = (url) => {
                    const parsedUrl = new URL(url);
                    return `${parsedUrl.protocol}//${parsedUrl.hostname}`;
                };
                let link = getBaseUrl(url);
                const logo = `${link}${$(element).find('img').attr('src')}`; // Ensure the logo URL is complete
                link = link.replace('https://', '');
                const chain = link === 'etherscan.io' ? "ethereum" 
                    : link === 'arbiscan.io' ? "arbitrum"
                        : link === 'lineascan.build' ? "linea" 
                            : link === 'polygonscan.com' ? "polygon" 
                                : link === 'blastscan.io' ? "blast" 
                                    : link === 'optimistic.etherscan.io' ? "optimism" : null;

                // console.log({ name, symbol, address, logo, chain, link });
                tokens.push({ name, symbol, address, logo, chain });
            }
        });
        // Filter out duplicates based on address
        return tokens.filter((token, index, self) =>
            index === self.findIndex((t) => t.address === token.address)
        );
    } catch (error) {
        console.error(`Error scraping ${url}:`, error);
        return [];
    }
}


// Function to scrape from multiple explorers and store the data
async function scrapeFromMultipleExplorers(urls) {
    const scrapePromises = urls.map(url => scrapeExplorerTokens(url));
    const results = await Promise.all(scrapePromises);
    const allTokens = results.flat();

    const connection = await pool.getConnection();
    // await connection.execute('DELETE FROM TempTokens');

    try {
        await connection.beginTransaction();
        
        // Insert tokens into TempTokens table
        const insertQuery = `INSERT IGNORE INTO TempTokens (name, symbol, address, logoURL, chain) VALUES (?, ?, ?, ?, ?)`;
        
        for (const token of allTokens) {
            await connection.query(insertQuery, [token.name, token.symbol, token.address, token.logo, token.chain]);
        }

        console.log('All tokens successfully stored in TempTokens!');
    } catch (error) {
        await connection.rollback();
        console.error('Error storing tokens in TempTokens:', error);
    } finally {
        connection.release();
    }
}

// Main execution
(async () => {
    const explorerUrls = [
        'https://etherscan.io/tokens?ps=100',
        'https://etherscan.io/tokens?ps=100&p=2',
        'https://etherscan.io/tokens?ps=100&p=3',
        'https://etherscan.io/tokens?ps=100&p=4',
        'https://etherscan.io/tokens?ps=100&p=5',
        'https://etherscan.io/tokens?ps=100&p=6',
        'https://etherscan.io/tokens?ps=100&p=7',
        'https://etherscan.io/tokens?ps=100&p=8',
        'https://etherscan.io/tokens?ps=100&p=9',
        'https://etherscan.io/tokens?ps=100&p=10',
        'https://etherscan.io/tokens?ps=100&p=11',
        'https://etherscan.io/tokens?ps=100&p=12',
        'https://etherscan.io/tokens?ps=100&p=13',
        'https://etherscan.io/tokens?ps=100&p=14',
        'https://etherscan.io/tokens?ps=100&p=15',
        'https://etherscan.io/tokens?ps=100&p=16',
        'https://etherscan.io/tokens?ps=100&p=17',
        'https://etherscan.io/tokens?ps=100&p=18',
        'https://lineascan.build/tokens?ps=100',
        'https://blastscan.io/tokens?ps=100',
        'https://polygonscan.com/tokens?ps=100',
        'https://polygonscan.com/tokens?ps=100&p=2',
        'https://polygonscan.com/tokens?ps=100&p=3',
        'https://polygonscan.com/tokens?ps=100&p=4',
        'https://polygonscan.com/tokens?ps=100&p=5',
        'https://polygonscan.com/tokens?ps=100&p=6',
        'https://polygonscan.com/tokens?ps=100&p=7',
        'https://polygonscan.com/tokens?ps=100&p=8',
        'https://polygonscan.com/tokens?ps=100&p=9',
        'https://optimistic.etherscan.io/tokens?ps=100',
        'https://optimistic.etherscan.io/tokens?ps=100&p=2',
        'https://optimistic.etherscan.io/tokens?ps=100&p=3',
        'https://optimistic.etherscan.io/tokens?ps=100&p=4',
        'https://optimistic.etherscan.io/tokens?ps=100&p=5',
        'https://arbiscan.io/tokens?ps=100',
        'https://arbiscan.io/tokens?ps=100&p=2',
        'https://arbiscan.io/tokens?ps=100&p=3',
        'https://arbiscan.io/tokens?ps=100&p=4',
    ];

    await scrapeFromMultipleExplorers(explorerUrls);
})();

