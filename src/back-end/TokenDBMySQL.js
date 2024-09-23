// npm i mysql2

CREATE DATABASE tokenDB;

USE tokenDB;

CREATE TABLE tokens (
    id VARCHAR(255) PRIMARY KEY,
    symbol VARCHAR(255),
    name VARCHAR(255),
    image VARCHAR(255) -- Optional
);


const express = require('express');
const mysql = require('mysql2/promise'); // Use promise-based API for async/await
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// MySQL connection settings
const dbConfig = {
    host: 'localhost',
    user: 'your_username',
    password: 'your_password',
    database: 'tokenDB',
};

async function connectDB() {
    const connection = await mysql.createConnection(dbConfig);
    return connection;
}

// Fetch and store tokens
async function fetchAndStoreTokens() {
    const connection = await connectDB();
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/list');
        const tokens = response.data;

        // Clear existing tokens
        await connection.execute('DELETE FROM tokens');

        // Prepare insert query
        const insertQuery = 'INSERT INTO tokens (id, symbol, name, image) VALUES (?, ?, ?, ?)';
        const insertPromises = tokens.map(token => {
            return connection.execute(insertQuery, [token.id, token.symbol, token.name, null]); // Adjust if you want to include the image
        });

        // Execute all insertions
        await Promise.all(insertPromises);
        console.log('Tokens stored successfully!');
    } catch (error) {
        console.error('Error fetching or storing tokens:', error);
    } finally {
        await connection.end(); // Ensure the connection is closed
    }
}

// Endpoint to fetch and store tokens
app.get('/api/fetch-tokens', async (req, res) => {
    await fetchAndStoreTokens();
    res.send('Tokens have been fetched and stored in the database.');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
