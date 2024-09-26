const mysql = require('mysql2/promise'); // Use promise-based API for async/await
const axios = require('axios');

// MySQL connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'SQLkatrix1004@',
    database: 'tokenDB',
};

// Function to connect to the database
async function connectDB() {
    const connection = await mysql.createConnection(dbConfig);
    return connection;
}

// Fetch tokens from CoinGecko and store them in the database
async function fetchAndStoreTokens() {
    const connection = await connectDB();
    try {
        // Fetch tokens from CoinGecko
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/list');
        const tokens = response.data;

        // Clear existing tokens
        await connection.execute('DELETE FROM tokens');

        // Prepare insert query
        const insertQuery = 'INSERT INTO tokens (id, symbol, name, address) VALUES (?, ?, ?, ?)';
        const insertPromises = tokens.map(token => {
            return connection.execute(insertQuery, [token.id, token.symbol, token.name, null]); // Store initial data with null address
        });

        // Execute all insertions
        await Promise.all(insertPromises);
        console.log('Tokens stored successfully!');

        // Fetch addresses from the provided URL
        const addressResponse = await axios.get('https://tokens.coingecko.com/uniswap/all.json');
        const addressData = addressResponse.data.tokens;

        // Create a map for quick lookup of addresses
        const addressMap = {};
        for (const token of addressData) {
            addressMap[token.name.toLowerCase()] = token.address; // Assuming token.name is the key
        }

        // Update the database with addresses
        for (const token of tokens) {
            const address = addressMap[token.name.toLowerCase()];
            if (address) {
                // Update the address where the name matches
                await connection.execute('UPDATE tokens SET address = ? WHERE name = ?', [address, token.name]);
            }
        }

        await connection.execute('DELETE FROM tokens WHERE address IS NULL');

        console.log('Tokens updated successfully with addresses!');
    } catch (error) {
        console.error('Error fetching or updating tokens:', error);
    } finally {
        await connection.end(); // Ensure the connection is closed
    }
}

// Run the fetch and store function
fetchAndStoreTokens();