const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// Alchemy settings
const settings = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ARB_MAINNET, // Adjust to the network you are using
};

const alchemy = new Alchemy(settings);

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
  }));

// Middleware to parse JSON
app.use(express.json());

app.post('/fetch-address-details', async (req, res) => {
    const { address } = req.body;

    if (!address) {
        return res.status(400).json({ error: 'Address is required' });
    }

    try {
        const balances = await alchemy.core.getTokenBalances(address);
        const tokenDetails = [];

        for (const token of balances.tokenBalances) {
            const metadata = await alchemy.core.getTokenMetadata(token.contractAddress);
            const readableBalance = ethers.formatUnits(token.tokenBalance, metadata.decimals);
            tokenDetails.push({
                name: metadata.name,
                symbol: metadata.symbol,
                balance: readableBalance,
            });
        }

        res.json({ tokenDetails });
    } catch (error) {
        console.error('Error fetching address details:', error);
        res.status(500).json({ error: 'Failed to fetch address details' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
