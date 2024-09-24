const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');
const cors = require('cors');
const mysql = require('mysql2/promise');


/** ----------------------------------------------------------------------------- 
-----------------------------  GLOBAL VARIABLES ---------------------------------
------------------------------------------------------------------------------ */

const app = express();
const port = process.env.PORT || 3001;

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'SQLkatrix1004@',
    database: 'tokenDB',
};

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

let validTokenAddresses;
let tokenNameToId;


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
    const connection = await mysql.createConnection(dbConfig);
    try {
        if(!validTokenAddresses){
            const [rows] = await connection.execute('SELECT address FROM tokens');
            return new Set(rows.map(token => token.address.toLowerCase()));
        } else {
            return validTokenAddresses;
        }
    } catch (error) {
        console.error('Error fetching token list from database:', error);
        return new Set(); 
    } finally {
        await connection.end(); // Ensure the connection is closed
    }
}

async function fetchTokenPrices(tokenIds) {
    const ids = tokenIds.join(',');

    try {
        const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);

        // Check if the response status is 429
        if (response.status === 429) {
            console.error('Rate limit exceeded. Please wait before making more requests.');
            // Implement a delay before retrying
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            return fetchTokenPrices(tokenIds); // Retry fetching prices
        }

        if (!response.ok) {
            throw new Error(`Error fetching prices: ${response.statusText}`);
        }

        const data = await response.json();
        return data; // Return price data
    } catch (error) {
        console.error('Error fetching token prices:', error);
        return {}; // Return an empty object or handle it as needed
    }
}

async function fetchTokenData() {
    const connection = await mysql.createConnection(dbConfig);
    try {
        if(!tokenNameToId) {
            const [rows] = await connection.execute('SELECT name, id FROM tokens');
            return rows.map(token => ({
                name: token.name.toLowerCase(),
                id: token.id
            }));
        } else {
            return tokenNameToId;
        }
    } catch (error) {
        console.error('Error fetching token data from database:', error);
        return [];
    } finally {
        await connection.end(); // Ensure the connection is closed
    }
}

// async function fetchTokenData() {
//     try {
//         const response = await axios.get('https://api.coingecko.com/api/v3/coins/list');
//         return response.data.map(token => ({
//             name: token.name.toLowerCase(),
//             id: token.id
//         }));
//     } catch (error) {
//         if (error.response && error.response.status === 429) {
//             console.error('Rate limit exceeded. Please wait before making more requests.');
//             // Optionally implement a delay here
//             await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
//             return fetchTokenData(); // Retry fetching the data
//         }
//         console.error('Error fetching token list:', error);
//         return [];
//     }
// }


/** ----------------------------------------------------------------------------- 
----------------------------- PORTFOLIO TRACKER ---------------------------------
------------------------------------------------------------------------------ */

/// @note Add native tokens as well
/** @dev fetchAddressDetails fetches the address's ERC-20 token assets
 * @param settings -> alchemy settiings for different chains
 * @param address -> the address value for which the tokens are being fetched
 */
async function fetchAddressDetails(settings, address) {
    const validTokenAddresses = await fetchTokenList();
    const tokenNameToId = await fetchTokenData();
    const alchemy = new Alchemy(settings);
    const balances = await alchemy.core.getTokenBalances(address);
    let tokenDetails = [];
    const tokenIds = [];

    for(const token of balances.tokenBalances) {
        const metadata = await alchemy.core.getTokenMetadata(token.contractAddress);
        if (!metadata || metadata.decimals === 0 || !metadata.name || !metadata.symbol) {
            continue;
        }
        if (!validTokenAddresses.has(token.contractAddress.toLowerCase())) {
            continue;
        }
        const tokenId = tokenNameToId.find(t => t.name.toLowerCase() === metadata.name.toLowerCase());
        if(!tokenId) {
            continue;
        }
        console.log("Token found", tokenId.id);
        const readableBalance = ethers.formatUnits(token.tokenBalance, metadata.decimals);
        if(parseFloat(readableBalance) > 0) {
            tokenIds.push(tokenId.id);
            tokenDetails.push({
                tokenBalance: readableBalance, 
                tokenName: metadata.name, 
                tokenSymbol: metadata.symbol, 
                tokenId: tokenId.id,
                tokenPrice: 0});
        }
    }

    const tokenPrices = await fetchTokenPrices(tokenIds);
    console.log(tokenPrices);
    Object.values(tokenDetails).forEach(token => {
        const tokenId = token.tokenId;
        token.tokenPrice = tokenPrices[tokenId] ? tokenPrices[tokenId].usd : 0;
        console.log(token.tokenName, token.tokenBalance, token.tokenSymbol, token.tokenPrice, "USD");
    });
    return(tokenDetails);
}

/** @dev address value is passed here and tokens across multiple chains are checked */
/** @param req -> req.body == the address passed*/
app.post('/fetch-address-details', async (req, res) => {
    const { address } = req.body;
    const chains = {
        eth: settingsEthereum,
        arb: settingsArbitrum,
        opt: settingsOptimism,
        pol: settingsPolygon,
        zk: settingsZksync,
        avax: settingsAvalanche,
        blast: settingsBlast,
    }

    if (!address) {
        return res.status(400).json({ error: 'Address is required' });
    }
    try {
        const tokens = await Promise.all(Object.values(chains).map(chain => fetchAddressDetails({apiKey: chain.apiKey, network: chain.network}, address)));
        res.json({ tokens });
    } catch (error) {
        console.error('Error fetching address details:', error);
        res.status(500).json({ error: 'Failed to fetch address details' });
    }
});


/** ----------------------------------------------------------------------------- 
-------------------------------- ADDRESS TTV ------------------------------------
------------------------------------------------------------------------------ */

/// @note fetch USD values
/// @note see what you can do for Linea and Avalanche
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
                const isValidToken = validTokenAddresses.some(token => token.address === tx.rawContract.address.toLowerCase());
                return isValidToken;
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

///@note fetch USD values
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


/** -----------------------------------------------------------------------------
 * ----------------------------- RECENT TXS TABLE -------------------------------
 * --------------------------------------------------------------------------- */

async function recentTxs(settings) {
    const alchemy = new Alchemy(settings);
    const validTokenAddresses = await fetchTokenList();
    const txs = await alchemy.core.getAssetTransfers({
        fromBlock: 'latest',
        category: ['erc20', 'external'],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: 50,
    });
    const filteredTxs = txs.transfers.filter(tx => {
        if (tx.category === 'erc20') {
            return validTokenAddresses.has(tx.rawContract.address.toLowerCase());
        } else if (tx.category === 'external') {
            return true;
        }
        return false;
    });
    console.log("Txs fetched");
    return filteredTxs;
}

app.get('/recent-txs', async (req, res) => {
    try {
        const chains = {
            eth: settingsEthereum,
            arb: settingsArbitrum,
            opt: settingsOptimism,
            pol: settingsPolygon,
            zk: settingsZksync,
        };
        const allTransfers = await Promise.all(Object.values(chains).map(chain => recentTxs({apiKey: chain.apiKey, network: chain.network})));
        console.log(allTransfers);
        res.json({txs: allTransfers});
    } catch(error) {
        res.status(500).json({ error: 'An error occurred while fetching recent transactions' });
    }
});

/// @note add balance history, figure out how you can fetch the data once you click on a token value
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});