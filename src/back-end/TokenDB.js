// models/Token.js
//npm i mongoose
const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
    id: String,
    symbol: String,
    name: String,
    image: String, // Optional
});

module.exports = mongoose.model('Token', tokenSchema);

// OTHER FILE
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const Token = require('./models/Token'); // Adjust the path as necessary

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/tokenDB', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// Fetch tokens from CoinGecko
async function fetchAndStoreTokens() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/list');
        const tokens = response.data;

        // Optional: Clear existing tokens in the database
        await Token.deleteMany({});

        // Store tokens in the database
        await Token.insertMany(tokens);
        console.log('Tokens stored successfully!');
    } catch (error) {
        console.error('Error fetching tokens:', error);
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
