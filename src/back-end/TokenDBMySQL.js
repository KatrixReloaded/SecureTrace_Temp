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
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/list');
        const tokens = response.data;

        await connection.execute('DELETE FROM tokens');

        const insertQuery = 'INSERT INTO tokens (id, symbol, name, address) VALUES (?, ?, ?, ?)';
        const insertPromises = tokens.map(token => {
            return connection.execute(insertQuery, [token.id, token.symbol, token.name, null]);
        });

        await Promise.all(insertPromises);
        console.log('Tokens stored successfully!');

        const addressResponse = await axios.get('https://tokens.coingecko.com/uniswap/all.json');
        const addressData = addressResponse.data.tokens;

        const addressMap = {};
        for (const token of addressData) {
            addressMap[token.name.toLowerCase()] = token.address.toLowerCase();
        }
        const logoMap = {};
        for (const token of addressData) {
            logoMap[token.name.toLowerCase()] = token.logoURI;
        }

        for (const token of tokens) {
            const address = addressMap[token.name.toLowerCase()];
            if (address) {
                await connection.execute('UPDATE tokens SET address = ? WHERE name = ?', [address, token.name]);
            }
        }
        for (const token of tokens) {
            const logo = logoMap[token.name.toLowerCase()];
            if (logo) {
                await connection.execute('UPDATE tokens SET logo = ? WHERE name = ?', [logo, token.name]);
            }
        }

        await connection.execute('DELETE FROM tokens WHERE address IS NULL');

        console.log('Tokens updated successfully with addresses!');
    } catch (error) {
        console.error('Error fetching or updating tokens:', error);
    } finally {
        connection.release(); // Ensure the connection is closed
    }
}

fetchAndStoreTokens();
