const mysql = require('mysql2/promise'); // Use promise-based API for async/await
const axios = require('axios');

// Create a MySQL connection pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'SQLkatrix1004@',
    database: 'tokenDB',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function addOrUpdateTokenPrice(id, tokenPrice) {
    try {
        const connection = await pool.getConnection();  // Get a connection from the pool

        // SQL query with ON DUPLICATE KEY UPDATE for upserting token prices
        const sql = `
            INSERT INTO tokenPrices (id, tokenPrice)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE
                tokenPrice = IF(TIMESTAMPDIFF(MINUTE, createdAt, CURRENT_TIMESTAMP) >= 5, VALUES(tokenPrice), tokenPrice),
                createdAt = IF(TIMESTAMPDIFF(MINUTE, createdAt, CURRENT_TIMESTAMP) >= 5, CURRENT_TIMESTAMP, createdAt)
        `;

        // Execute the query with provided values
        await connection.execute(sql, [id, tokenPrice]);

        connection.release();  // Release the connection back to the pool

        return result;  // Return the result from the query execution
    } catch (error) {
        console.error('Error inserting or updating token price:', error);
        throw error;  // Rethrow error to be handled by the caller
    }
}

module.exports = { addOrUpdateTokenPrice };