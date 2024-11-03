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

fetchPrices();
