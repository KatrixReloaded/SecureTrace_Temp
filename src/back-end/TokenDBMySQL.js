const mysql = require('mysql2/promise');
const axios = require('axios');
require('dotenv').config();
const {getConnection} = require('./db');

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
    const connection = await getConnection();
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
    const connection = await getConnection();
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
    const connection = await getConnection();
    try {
        const [rows] = await connection.query('SELECT * FROM TempTokens');
        console.log(rows);
    } catch(error) {
        console.error(error);
    } finally {
        connection.release();
    }
}

fetchData();