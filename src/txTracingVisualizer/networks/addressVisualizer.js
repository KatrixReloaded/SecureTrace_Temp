const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');
const cors = require('cors');


/** ----------------------------------------------------------------------------- 
-----------------------------  GLOBAL VARIABLES ---------------------------------
------------------------------------------------------------------------------ */

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

const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());


/** ----------------------------------------------------------------------------- 
 ------------------------------ COMMON FUNCTIONS ---------------------------------
 ------------------------------------------------------------------------------ */
 
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

async function fetchTokenPrice(tokenSymbols) {
    const ids = tokenSymbols.join(',');
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    const data = await response.json();
    return data; // Return price in USD or 0 if not found
}


/** ----------------------------------------------------------------------------- 
----------------------------- PORTFOLIO TRACKER ---------------------------------
------------------------------------------------------------------------------ */

/** @dev fetchAddressDetails fetches the address's ERC-20 token assets
 * @param settings -> alchemy settiings for different chains
 * @param address -> the address value for which the tokens are being fetched
 */
async function fetchAddressDetails(settings, address) {
    const validTokenAddresses = await fetchTokenList();
    const alchemy = new Alchemy(settings);
    const balances = await alchemy.core.getTokenBalances(address);
    let tokenDetails = [];
    const tokenNames = [];
    for(const token of balances.tokenBalances) {
        const metadata = await alchemy.core.getTokenMetadata(token.contractAddress);
        if (!metadata || metadata.decimals === 0 || !metadata.name || !metadata.symbol) {
            continue;
        }
        if (!validTokenAddresses.has(token.contractAddress.toLowerCase())) {
            continue;
        }
        const readableBalance = ethers.formatUnits(token.tokenBalance, metadata.decimals);
        if(parseFloat(readableBalance) > 0) {
            const tokenName = metadata.name.toLowerCase().replace(/\s+/g, '-');
            console.log("Token Name", tokenName);
            tokenNames.push(tokenName);
            tokenDetails.push({tokenBalance: readableBalance, tokenName: metadata.name, tokenSymbol: metadata.symbol, tokenPrice: 0});
        }
    }
    const tokenPrices = await fetchTokenPrice(tokenNames);
    Object.values(tokenDetails).forEach(token => {
        const tokenName = token.tokenName.toLowerCase().replace(/\s+/g, '-');
        token.tokenPrice = tokenPrices[tokenName] ? tokenPrices[tokenName].usd : 0;
        console.log(token.tokenName, token.tokenSymbol, token.tokenPrice, token.tokenBalance);
    });
    return(tokenDetails);
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
        console.log("Fetching eth assets");
        tokens.push(await fetchAddressDetails(settingsEthereum, address));
        console.log("Fetching arb assets");
        tokens.push(await fetchAddressDetails(settingsArbitrum, address));
        console.log("Fetching avax assets");
        tokens.push(await fetchAddressDetails(settingsAvalanche, address));
        console.log("Fetching blast assets");
        tokens.push(await fetchAddressDetails(settingsBlast, address));
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


/** ----------------------------------------------------------------------------- 
-------------------------------- ADDRESS TTV ------------------------------------
------------------------------------------------------------------------------ */

/** @dev function to fetch all transfers made out from and into the given address
 * @param settings -> alchemy settings for different chains
 * @param address -> the address value for which the transfers need to be checked
 */
async function tokenTransfers(settings, address) {
    const alchemy = new Alchemy(settings);
    const validTokenAddresses = await fetchTokenList();

    const fetchTransfers = async (direction) => {
        let transfers = {};

        if(direction === 'from') {
            transfers = await alchemy.core.getAssetTransfers({
                fromBlock: '0x0',
                toBlock: 'latest',
                fromAddress: address,
                category: ['erc20'],
                withMetadata: true,
                excludeZeroValue: true,
                maxCount: 100,
            });
        } else {
            transfers = await alchemy.core.getAssetTransfers({
                fromBlock: '0x0',
                toBlock: 'latest',
                toAddress: address,
                category: ['erc20'],
                withMetadata: true,
                excludeZeroValue: true,
                maxCount: 100,
            });
        }

        return transfers.transfers.filter(tx => {
            if (tx.category === 'erc20') {
                return validTokenAddresses.has(tx.rawContract.address.toLowerCase());
            } else if (tx.category === 'external') {
                return true;
            }
            return false;
        });
    };

    const [fromTransfers, toTransfers] = await Promise.all([
        fetchTransfers('from'),
        fetchTransfers('to'),
    ]);

    console.log("From Transfers");
    console.log("To Transfers");
    return {
        fromTransfers,
        toTransfers,
    };
}

/** @dev address value is passed here to fetch all to and from transfer of tokens from that address
 * @param req -> req.params.address == the address passed
 */
app.get('/token-transfers/:address', async (req, res) => {
    const address = req.params.address;
    const chains = {
        eth: settingsEthereum,
        arb: settingsArbitrum,
        opt: settingsOptimism,
        pol: settingsPolygon,
        zk: settingsZksync,
    }
    const allFromTransfers = [];
    const allToTransfers = [];

    try {
        const allTransfers = await Promise.all(Object.values(chains).map(chain => tokenTransfers({apiKey: chain.apiKey, network: chain.network}, address)));
        console.log("Transfers mapped \n", allTransfers);
        Object.values(allTransfers).forEach(transfers => allFromTransfers.push(transfers.fromTransfers));
        Object.values(allTransfers).forEach(transfers => allToTransfers.push(transfers.toTransfers));

        res.json({
            from: allFromTransfers,
            to: allToTransfers,
        });
    } catch (error) {
        res.status(500).json({ error: 'An error occurred while fetching token transfers' });
    }
});


/** ----------------------------------------------------------------------------- 
------------------------------ TRANSACTION TTV ----------------------------------
------------------------------------------------------------------------------ */

async function fetchTokenTransfersFromTx(txHash, providerUrl, settings) {
    try {
        const provider = new ethers.JsonRpcProvider(`${providerUrl}`);
        const alchemy = new Alchemy(settings);
        const receipt = await alchemy.core.getTransactionReceipt(txHash);

        if (!receipt) {
            console.log('Transaction not found!');
            return 0;
        }

        console.log(`Found ${receipt.logs.length} logs in the transaction...`);

        const tokenTransfers = receipt.logs.filter(log => log.topics[0] === ERC20_TRANSFER_TOPIC);

        const decodedTransfers = await Promise.all(tokenTransfers.map(async (log) => {
            const from = ethers.getAddress(log.topics[1].slice(26));
            const to = ethers.getAddress(log.topics[2].slice(26));
            const value = BigInt(log.data);
            const contract = new ethers.Contract(log.address, ERC20_ABI, provider);
            let name = "";
            let symbol = "";
            let decimals = 0;
            try {
                name = await contract.name();
                symbol = await contract.symbol();
                decimals = await contract.decimals();
            } catch (error) {
                console.error(`Error fetching token details for ${log.address}:`, error);
            }

            return {
                from,
                to,
                value: ethers.formatUnits(value, decimals), // Assuming token with 18 decimals
                contractAddress: log.address,
                tokenName: name,
                tokenSymbol: symbol
            };
        }));

        return decodedTransfers;
    } catch (error) {
        console.error('Error fetching token transfers:', error);
    }
}

app.get('/fetch-transaction-details/:txhash', async (req, res) => {
    const txhash = req.params.txhash;

    try {
        console.log("Fetching internal transfers for Ethereum");
        const ethTransfers = await fetchTokenTransfersFromTx(txhash, `https://eth-mainnet.g.alchemy.com/v2/${settingsEthereum.apiKey}`, settingsEthereum);
        if(ethTransfers !== 0) {
            res.json({ transfers: ethTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Arbitrum");
        const arbTransfers = await fetchTokenTransfersFromTx(txhash, `https://arb-mainnet.g.alchemy.com/v2/${settingsArbitrum.apiKey}`, settingsArbitrum);
        if(arbTransfers !== 0) {
            res.json({ transfers: arbTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Polygon");
        const polTransfers = await fetchTokenTransfersFromTx(txhash, `https://polygon-mainnet.g.alchemy.com/v2/${settingsPolygon.apiKey}`, settingsPolygon);
        if(polTransfers !== 0) {
            res.json({ transfers: polTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Optimism");
        const optTransfers = await fetchTokenTransfersFromTx(txhash, `https://opt-mainnet.g.alchemy.com/v2/${settingsOptimism.apiKey}`, settingsOptimism);
        if(optTransfers !== 0) {
            res.json({ transfers: optTransfers, });
            return;
        }

        console.log("Fetching internal transfers for zkSync");
        const zkTransfers = await fetchTokenTransfersFromTx(txhash, `https://zksync-mainnet.g.alchemy.com/v2/${settingsZksync.apiKey}`, settingsZksync);
        if(zkTransfers !== 0) {
            res.json({ transfers: zkTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Linea");
        const lineaTransfers = await fetchTokenTransfersFromTx(txhash, `https://linea-mainnet.g.alchemy.com/v2/${settingsLinea.apiKey}`, settingsLinea);
        if(lineaTransfers !== 0) {
            res.json({ transfers: lineaTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Blast");
        const blastTransfers = await fetchTokenTransfersFromTx(txhash, `https://blast-mainnet.g.alchemy.com/v2/${settingsBlast.apiKey}`, settingsBlast);
        if(blastTransfers !== 0) {
            res.json({ transfers: blastTransfers, });
            return;
        }

        res.json({ transfers: "Transaction not found", });
    } catch(error) {
        res.status(500).json({ error: 'An error occurred while fetching token transfers' });
    }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});