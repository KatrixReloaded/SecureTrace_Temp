const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');
const cors = require('cors');

/** --------------------------------------------------------------------- 
-------------------------  GLOBAL VARIABLES -----------------------------
---------------------------------------------------------------------- */

const app = express();
const port = process.env.PORT || 3001;

const settingsArbitrum = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ARB_MAINNET, 
};
const settingsEthereum = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ETH_MAINNET, 
};
//@note Linea is not supported by Alchemy SDK functions like getAssetTransfers() and getTokenBalances()
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
//@note Blast is not supported by Alchemy SDK functions like getAssetTransfers()
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


/** --------------------------------------------------------------------- 
-------------------------- COMMON FUNCTIONS -----------------------------
---------------------------------------------------------------------- */


/** @dev checks whether the token is a valid/official token and not some bs*/
async function fetchTokenList() {
    try {
        const response = await axios.get('https://tokens.coingecko.com/uniswap/all.json');
        const tokens = response.data.tokens;
        return new Set(tokens.map(token => token.address.toLowerCase())); 
    } catch (error) {
        console.error('Error fetching token list:', error);
        return new Set(); 
    }
}


/** --------------------------------------------------------------------- 
------------------------- PORTFOLIO TRACKER -----------------------------
---------------------------------------------------------------------- */


/** @dev fetchAddressDetails fetches the address's ERC-20 token assets
 * @param settings -> alchemy settiings for different chains
 * @param address -> the address value for which the tokens are being fetched
 */
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

/** @dev just in case we need to set a timeout 
 * @param target function to set a timeout for it
*/
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

/** @dev address value is passed here and tokens across multiple chains are checked */
/** @param req -> req.body == the address passed*/
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


/** --------------------------------------------------------------------- 
---------------------------- ADDRESS TTV --------------------------------
---------------------------------------------------------------------- */


/** @dev function to fetch all transfers made out from the given address
 * @param settings -> alchemy settings for different chains
 * @param address -> the address value from which the transfers have been made
 */
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

/** @dev function to fetch transfers made to the given address
 * @param settings -> alchemy settings for different chains
 * @param address -> the address value to which the transfers have been made
 */
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

/** @dev address value is passed here to fetch all to and from transfer of tokens from that address
 * @param req -> req.params.address == the address passed
 */
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