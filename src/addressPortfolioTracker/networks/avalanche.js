const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');

const ADDRESS = '0x400FF1835A4A11C7E77B12240EB227D5EcC75767';
const settings = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.AVAX_MAINNET,
}

const alchemy = new Alchemy(settings)

async function fetchAddressDetails() {
    const balances = await alchemy.core.getTokenBalances(ADDRESS);
    for(const token of balances.tokenBalances) {
        const metadata = await alchemy.core.getTokenMetadata(token.contractAddress);
        const readableBalance = ethers.formatUnits(token.tokenBalance, metadata.decimals);
        console.log(`Token: ${metadata.name}`);
        console.log(`Balance: ${readableBalance} ${metadata.symbol}`);
    }
}

fetchAddressDetails();