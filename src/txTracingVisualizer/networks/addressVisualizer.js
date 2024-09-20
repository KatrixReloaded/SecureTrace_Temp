const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');
const cors = require('cors');

const app = express();
const port = 3002;

const settingsArbitrum = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ARB_MAINNET, 
};
const settingsEthereum = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ETH_MAINNET, 
};
const settingsLinea = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.LINEA_MAINNET, 
};
const settingsAvalanche = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.AVAX_MAINNET, 
};
const settingsOptimism = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.OPT_MAINNET, 
};
const settingsBlast = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.BLAST_MAINNET, 
};
const settingsPolygon = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.MATIC_MAINNET, 
};
const settingsZksync = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ZKSYNC_MAINNET, 
};

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

async function tokenTransfersFrom(settings, address) {
    const alchemy = new Alchemy(settings);

    const fromTransfers = await alchemy.core.getAssetTransfers({
        fromBlock: '0x0',
        toBlock: 'latest',
        fromAddress: address,
        category: ['erc20', 'external'],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: 10, 
    });
    console.log("From Transfers");
    return({
        fromTransfers,
    });
}

async function tokenTransfersTo(settings, address) {
    const alchemy = new Alchemy(settings);
    
    const toTransfers = await alchemy.core.getAssetTransfers({
        fromBlock: '0x0',
        toBlock: 'latest',
        toAddress: address,
        category: ['erc20', 'external'],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: 10, 
    });
    console.log("To Transfers");
    return({
        toTransfers: toTransfers,
    });
}

app.get('/token-transfers/:address', async (req, res) => {
  const address = req.params.address;
  const allFromTransfers = [];
    const allToTransfers = [];

    try {
        console.log('Fetching transfers for Ethereum');
        const ethFromTransfers = await tokenTransfersFrom(settingsEthereum, address);
        console.log("Eth from transfers", ethFromTransfers.fromTransfers);
        const ethToTransfers = await tokenTransfersTo(settingsEthereum, address);
        console.log("Eth to transfers", ethToTransfers.toTransfers);
        allFromTransfers.push(...ethFromTransfers.fromTransfers.transfers);
        allToTransfers.push(...ethToTransfers.toTransfers.transfers);

        console.log('Fetching transfers for Arbitrum');
        const arbFromTransfers = await tokenTransfersFrom(settingsArbitrum, address);
        const arbToTransfers = await tokenTransfersTo(settingsArbitrum, address);
        allFromTransfers.push(...arbFromTransfers.fromTransfers.transfers);
        allToTransfers.push(...arbToTransfers.toTransfers.transfers);

        console.log('Fetching transfers for Avalanche');
        const avaxFromTransfers = await tokenTransfersFrom(settingsAvalanche, address);
        const avaxToTransfers = await tokenTransfersTo(settingsAvalanche, address);
        allFromTransfers.push(...avaxFromTransfers.fromTransfers.transfers);
        allToTransfers.push(...avaxToTransfers.toTransfers.transfers);

        /* ---------- getAssetTransfers() DOES NOT SUPPORT THESE CHAINS ---------- */
        
        // console.log('Fetching transfers for Blast');
        // const blastFromTransfers = await tokenTransfersFrom(settingsBlast, address);
        // const blastToTransfers = await tokenTransfersTo(settingsBlast, address);
        // allFromTransfers.push(...blastFromTransfers.fromTransfers.transfers);
        // allToTransfers.push(...blastToTransfers.toTransfers.transfers);

        // console.log('Fetching transfers for Linea');
        // const lineaFromTransfers = await tokenTransfersFrom(settingsLinea, address);
        // const lineaToTransfers = await tokenTransfersTo(settingsLinea, address);
        // allFromTransfers.push(...lineaFromTransfers.fromTransfers.transfers);
        // allToTransfers.push(...lineaToTransfers.toTransfers.transfers);

        console.log('Fetching transfers for Optimism');
        const optFromTransfers = await tokenTransfersFrom(settingsOptimism, address);
        const optToTransfers = await tokenTransfersTo(settingsOptimism, address);
        allFromTransfers.push(...optFromTransfers.fromTransfers.transfers);
        allToTransfers.push(...optToTransfers.toTransfers.transfers);

        console.log('Fetching transfers for Polygon');
        const polyFromTransfers = await tokenTransfersFrom(settingsPolygon, address);
        const polyToTransfers = await tokenTransfersTo(settingsPolygon, address);
        allFromTransfers.push(...polyFromTransfers.fromTransfers.transfers);
        allToTransfers.push(...polyToTransfers.toTransfers.transfers);

        console.log('Fetching transfers for zkSync');
        const zkFromTransfers = await tokenTransfersFrom(settingsZksync, address);
        const zkToTransfers = await tokenTransfersTo(settingsZksync, address);
        allFromTransfers.push(...zkFromTransfers.fromTransfers.transfers);
        allToTransfers.push(...zkToTransfers.toTransfers.transfers);

    res.json({
        from: allFromTransfers,
        to: allToTransfers,
    });    
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while fetching token transfers' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});