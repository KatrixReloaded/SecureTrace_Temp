const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// Alchemy settings
const settingsArbitrum = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ARB_MAINNET, // Adjust to the network you are using
};
const settingsEthereum = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ETH_MAINNET, // Adjust to the network you are using
};
const settingsLinea = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.LINEA_MAINNET, // Adjust to the network you are using
};
const settingsAvalanche = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.AVAX_MAINNET, // Adjust to the network you are using
};
const settingsOptimism = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.OPT_MAINNET, // Adjust to the network you are using
};
const settingsBlast = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.BLAST_MAINNET, // Adjust to the network you are using
};
const settingsPolygon = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.MATIC_MAINNET, // Adjust to the network you are using
};
const settingsZksync = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ZKSYNC_MAINNET, // Adjust to the network you are using
};


app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

// Middleware to parse JSON
app.use(express.json());

async function fetchAddressDetails(settings, address) {
    let validTokenAddresses = await fetchTokenList();
    const alchemy = new Alchemy(settings);
    const balances = await alchemy.core.getTokenBalances(address);
    const tokenDetails = [];
    for(const token of balances.tokenBalances) {
        const metadata = await alchemy.core.getTokenMetadata(token.contractAddress);
        if (!metadata || metadata.decimals === 0 || !metadata.name || !metadata.symbol) {
            console.log(`Skipping token: ${token.contractAddress}, missing metadata`);
            continue;
        }
        if (!validTokenAddresses.has(token.contractAddress.toLowerCase())) {
            console.log(`Skipping token: ${token.contractAddress}, not in valid token list`);
            continue;
        }
        const readableBalance = ethers.formatUnits(token.tokenBalance, metadata.decimals);
        console.log(`Token: ${metadata.name} (${metadata.symbol}), Balance: ${readableBalance} ${token.tokenBalance}`);
        if(parseFloat(readableBalance) > 0) {
            tokenDetails.push({tokenBalance: readableBalance, tokenName: metadata.name, tokenSymbol: metadata.symbol});
            console.log({tokenBalance: readableBalance, tokenName: metadata.name, tokenSymbol: metadata.symbol});
        }
    }
    return(tokenDetails);
}

async function fetchTokenList() {
    try {
        const response = await axios.get('https://tokens.coingecko.com/uniswap/all.json');
        const tokens = response.data.tokens;
        return new Set(tokens.map(token => token.address.toLowerCase())); // Store addresses in lowercase for case-insensitive comparison
    } catch (error) {
        console.error('Error fetching token list:', error);
        return new Set(); // Return an empty set on error
    }
}

async function fetchWithTimeout(fetchFunction, timeout = 120000) {
    const abortController = new AbortController();
    const id = setTimeout(() => abortController.abort(), timeout);
    try {
        const result = await fetchFunction();
        clearTimeout(id);
        return result;
    } catch (error) {
        throw new Error('Request timed out');
    }
}


app.post('/fetch-address-details', async (req, res) => {
    const { address } = req.body;

    if (!address) {
        return res.status(400).json({ error: 'Address is required' });
    }
    let tokens = [];
    try {
        console.log("Fetching arb assets");
        tokens.push(await fetchAddressDetails(settingsArbitrum, address));
        console.log("Fetching avax assets");
        tokens.push(await fetchAddressDetails(settingsAvalanche, address));
        console.log("Fetching blast assets");
        tokens.push(await fetchAddressDetails(settingsBlast, address));
        console.log("Fetching eth assets");
        tokens.push(await fetchAddressDetails(settingsEthereum, address));
        console.log("Fetching linea assets");
        // tokens.push(await fetchAddressDetails(settingsLinea, address));
        console.log("Fetching opt assets");
        tokens.push(await fetchAddressDetails(settingsOptimism, address));
        console.log("Fetching pol assets");
        tokens.push(await fetchAddressDetails(settingsPolygon, address));
        console.log("Fetching zk assets");
        tokens.push(await fetchAddressDetails(settingsZksync, address));
        res.json({ tokens });
    } catch (error) {
        console.error('Error fetching address details:', error);
        res.status(500).json({ error: 'Failed to fetch address details' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
