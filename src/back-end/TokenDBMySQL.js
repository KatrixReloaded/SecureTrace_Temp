const mysql = require('mysql2/promise');
const axios = require('axios');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

async function fetchAndStoreTokens() {
    const connection = await pool.getConnection();
    try {
        const response = await axios.get('https://tokens.coingecko.com/uniswap/all.json');
        const tokens = response.data.tokens;

        await connection.execute('DELETE FROM DLTokens');

        const insertQuery = `INSERT IGNORE INTO DLTokens (address, name, symbol, decimals, logo_url) VALUES (?, ?, ?, ?, ?)`;

        const insertPromises = tokens
            .filter(token => token.address && token.symbol)
            .map(token => {
                return connection.execute(insertQuery, [
                    token.address.toLowerCase(),
                    token.name || null,
                    token.symbol,
                    token.decimals || 18,
                    token.logoURI || null,
                ]);
            });

        await Promise.all(insertPromises);
        console.log('Tokens stored successfully!');
    } catch (error) {
        console.error('Error fetching or updating tokens:', error);
    } finally {
        connection.release();
    }
}

async function fetchPrices() {
    const connection = await pool.getConnection();
    try {
        const [tokens] = await connection.execute('SELECT chain, address FROM DLTokens');
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
                        connection.execute('UPDATE DLTokens SET price = ? WHERE address = ?', [priceData.price, token.address])
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

// async function updateChainId() {
//     const connection = await pool.getConnection();
//     await connection.execute('UPDATE DLTokens SET chain = ?', ["ethereum"]);
// }

fetchPrices();
