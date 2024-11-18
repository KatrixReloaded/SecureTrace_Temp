const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');
const cors = require('cors');
const mysql = require('mysql2/promise');
const algosdk = require('algosdk');
const NodeCache = require('node-cache');
const Semaphore = require('semaphore');
const cache = new NodeCache({ stdTTL: 300 }); // Cache TTL of 5 minutes
const semaphore = Semaphore(5); // Limit to 5 concurrent API calls
// const { addOrUpdateTokenPrice } = require('./TokenPricesDB');


/** ----------------------------------------------------------------------------- 
-----------------------------  GLOBAL VARIABLES ---------------------------------
------------------------------------------------------------------------------ */

const app = express();
const port = process.env.PORT || 3002;

/** @dev config for Token Database */
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

/** @dev settings for different chains (EVM-based) */
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
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  }));

app.use(express.json());

app.post('/', (req, res) => {
    res.send('Hello, SecureTrace is live!');
});

let validTokenAddresses;
let tokenNameToId;


/** ----------------------------------------------------------------------------- 
----------------------------- DATABASE FUNCTIONS --------------------------------
------------------------------------------------------------------------------ */

/** @notice this function is used to add or update values to the tokenPrices table
 * @dev the function accepts token ID and price values and adds them to the database only if it is a new token or the token price is older than 5 minutes
 * @param id -> the token ID for which the price is being added
 * @param tokenPrice -> the price of the token
 */
// async function addOrUpdateTokenPrice(id, tokenPrice) {
//     try {
//         const connection = await pool.getConnection();

//         const sql = `
//             INSERT INTO tokenPrices (id, tokenPrice)
//             VALUES (?, ?)
//             ON DUPLICATE KEY UPDATE
//                 tokenPrice = IF(TIMESTAMPDIFF(MINUTE, createdAt, CURRENT_TIMESTAMP) >= 5, VALUES(tokenPrice), tokenPrice),
//                 createdAt = IF(TIMESTAMPDIFF(MINUTE, createdAt, CURRENT_TIMESTAMP) >= 5, CURRENT_TIMESTAMP, createdAt)
//         `;

//         await connection.execute(sql, [id, tokenPrice]);

//         connection.release();
//     } catch (error) {
//         console.error('Error inserting or updating token price:', error);
//         throw error;
//     }
// }


/** ----------------------------------------------------------------------------- 
 ----------------------------- COMMON FUNCTIONS ---------------------------------
 ------------------------------------------------------------------------------ */
 
 /** @dev just in case we need to set a timeout 
  * @param target function to set a timeout for it
 */
 async function fetchWithTimeout(fetchFunction, timeout = 5000) {
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

/** @dev checks whether the token is a valid/official token and not some bs */
async function fetchTokenList() {
    const connection = await pool.getConnection();
    try {
        if(!validTokenAddresses){
            const [rows] = await connection.execute('SELECT address FROM TempTokens');
            return new Set(rows.map(token => token.address));
        } else {
            return validTokenAddresses;
        }
    } catch (error) {
        console.error('Error fetching token list from database:', error);
        return new Set(); 
    } finally {
        connection.release();
    }
}

/** @notice function to fetch up-to-date token prices
 * @dev returns token prices for tokens whose prices have been updated less than 5 minutes ago
 * @param tokenIds -> set of IDs of tokens for which the USD value is fetched
 */
// async function getUpToDateTokenPrices(addresses) {
//     const connection = await pool.getConnection();
//     try {
//         if (tokenIds.length === 0) {
//             return {};
//         }
//         const placeholders = addresses.map(() => '?').join(',');
//         const query = `SELECT address, price FROM DLTokens WHERE address IN (${placeholders})`;

//         const [rows] = await connection.execute(query, addresses);

//         const tokenPrices = {};
//         for (const row of rows) {
//             tokenPrices[row.address] = { usd: row.tokenPrice };
//         }

//         return tokenPrices;
//     } catch (error) {
//         console.error('Error fetching up-to-date token prices:', error);
//         return {};
//     } finally {
//         connection.release();
//     }
// }

/** @notice Fetches current token price for a set of tokens
 * @dev fetches the current price based on tokenIds set
 * @param tokenIds -> set of IDs of tokens for which the USD value is fetched
 */
async function fetchTokenPrices(addresses) {
    const uniqueAddresses = [...new Set(addresses)];

    const connection = await pool.getConnection();
    const prices = async (ads) => { 
        try {
            if (ads.length === 0) {
                return {};
            }
            const placeholders = ads.map(() => '?').join(',');
            const query = `SELECT chain, address, price FROM TempTokens WHERE address IN (${placeholders})`;

            const [rows] = await connection.execute(query, ads);

            const tokenPrices = {};
            for (const row of rows) {
                tokenPrices[row.address] = { usd: row.price };
            }

            return tokenPrices;
        } catch (error) {
            console.error('Error fetching up-to-date token prices:', error);
            return {};
        } finally {
            connection.release();
        }
    };

    const upToDatePrices = await prices(uniqueAddresses);
    const allPrices = { ...upToDatePrices };

    return allPrices;
}

/** @notice function to fetch a token's ID
 * @dev accesses the tokenDB to return id values for respective token names
 */
async function fetchTokenData() {
    const connection = await pool.getConnection();
    try {
        if(!tokenNameToId) {
            const [rows] = await connection.execute('SELECT chain, address, name, symbol, decimals, logoURL FROM TempTokens');
            return rows.map(token => ({
                chain: token.chain,
                address: token.address,
                name: token.name ? token.name : null,
                symbol: token.symbol,
                decimals: token.decimals ? token.decimals : 18,
                logo: token.logoURL ? token.logoURL : null,
            }));
        } else {
            return tokenNameToId;
        }
    } catch (error) {
        console.error('Error fetching token data from database:', error);
        return [];
    } finally {
        connection.release();
    }
}

/**
 * @notice fetches the token list from CoinGecko API, called again for Algorand
 * @dev maps the token names to their respective IDs
 */
async function fetchCoinGeckoCoins() {
    const url = 'https://api.coingecko.com/api/v3/coins/list';
    const response = await fetch(url);
    const data = await response.json();
    const coinMap = {};
    
    data.forEach(coin => {
        coinMap[coin.name.toLowerCase()] = coin.id;
        coinMap[coin.symbol.toLowerCase()] = coin.id;
    });
    
    return coinMap;
}


/** ----------------------------------------------------------------------------- 
----------------------------- PORTFOLIO TRACKER ---------------------------------
------------------------------------------------------------------------------ */

/// @note Add native tokens as well
/**
 * @note Use address to fetch tokenBalances, then each token's metadata, while fetching metadata, 
 * @note call DefiLlama API to get the token's price, match the symbol with coingecko coins list and if missing, skip.
 * @note No need for token IDs here then, just use token address
 */
/** @notice fetches the address's ERC-20 token assets
 * @dev uses alchemy-sdk's `getTokenBalances` function to get a particular address's token assets
 * @param settings -> alchemy settiings for different chains
 * @param address -> the address value for which the tokens are being fetched
 */
async function fetchAddressDetails(settings, address) {
    const alchemy = new Alchemy(settings);

    const [validTokenAddresses, metadata, balances] = await Promise.all([
        fetchTokenList(),
        fetchTokenData(),
        alchemy.core.getTokenBalances(address),
    ]);

    const addresses = new Set();

    const tokenDetails = balances.tokenBalances.map(async (token) => {
        const contractAddress = token.contractAddress;

        if (!validTokenAddresses.has(contractAddress)) return null;

        const tokenMetadata = metadata.find(m => m.address === contractAddress);
        if (!tokenMetadata) return null;

        const readableBalance = ethers.formatUnits(token.tokenBalance, tokenMetadata.decimals);
        if (parseFloat(readableBalance) > 0) {
            addresses.add(contractAddress);
            return {
                chain: tokenMetadata.chain,
                tokenBalance: readableBalance,
                tokenName: tokenMetadata.name,
                tokenSymbol: tokenMetadata.symbol,
                tokenAddress: contractAddress,
                tokenPrice: 0,
                logo: tokenMetadata.logo,
            };
        }
        return null;
    });

    const resolvedTokenDetails = (await Promise.all(tokenDetails)).filter(detail => detail);

    const tokenPrices = await fetchTokenPrices(Array.from(addresses));
    resolvedTokenDetails.forEach(token => {
        token.tokenPrice = tokenPrices[token.tokenAddress]?.usd || 0;
    });

    return resolvedTokenDetails;
}

/** @dev address value is passed here and tokens across multiple chains are checked */
/** @param req -> req.body == the address passed*/
app.post('/fetch-address-details', async (req, res) => {
    const address = req.body.address;
    const chains = {
        ethereum: settingsEthereum,
        arbitrum: settingsArbitrum,
        optimism: settingsOptimism,
        polygon: settingsPolygon,
        // zk: settingsZksync,
        // avax: settingsAvalanche,
        blast: settingsBlast,
    };

    if (!address) {
        return res.status(400).json({ error: 'Address is required' });
    }
    
    try {
        // Fetch data in parallel for each chain
        const results = await Promise.all(
            Object.entries(chains).map(([chainKey, chainSettings]) =>
                fetchAddressDetails({ apiKey: chainSettings.apiKey, network: chainSettings.network }, address)
                    .then(tokens => tokens.map(token => ({ ...token, chain: chainKey })))
            )
        );

        // Flatten the results array and merge data from all chains
        const tokens = results.flat();

        res.json({ tokens });
    } catch (error) {
        console.error('Error fetching address details:', error);
        res.status(500).json({ error: 'Failed to fetch address details' });
    }
});


/** ----------------------------------------------------------------------------- 
-------------------------------- ADDRESS TTV ------------------------------------
------------------------------------------------------------------------------ */

/// @note see what you can do for Linea and Avalanche
/** @notice function to fetch all transfers made out from and into the given address
 * @dev calls getAssetTransfers to fetch all transfers made to and from a particular address
 * @dev includes ERC-20 tokens and native tokens
 * @param settings -> alchemy settings for different chains
 * @param address -> the address value for which the transfers need to be checked
 */
async function tokenTransfers(settings, address, blockNum) {
    const alchemy = new Alchemy(settings);
    const validTokenAddresses = await fetchTokenList();
    const metadata = await fetchTokenData();

    const fetchTransfers = async (direction) => {
        let transfers = {};

        if(direction === 'from') {
            transfers = await alchemy.core.getAssetTransfers({
                fromBlock: blockNum,
                toBlock: 'latest',
                fromAddress: address,
                category: ['erc20', 'external'],
                withMetadata: true,
                excludeZeroValue: true,
                maxCount: 100,
            });
        } else {
            transfers = await alchemy.core.getAssetTransfers({
                fromBlock: blockNum,
                toBlock: 'latest',
                toAddress: address,
                category: ['erc20', 'external'],
                withMetadata: true,
                excludeZeroValue: true,
                maxCount: 100,
            });
        }

        let filteredTxs = transfers.transfers.filter(tx => {
            if (tx.category === 'erc20') {
                const isValidToken = validTokenAddresses.has(tx.rawContract.address.toLowerCase());
                return isValidToken;
            } else if (tx.category === 'external') {
                return true;
            }
            return false;
        });

        console.log("Filtered Txs");
        filteredTxs = await Promise.all(filteredTxs.map(async (tx) => {
            let contractAddress = tx.rawContract?.address;
            // if(!contractAddress && tx.category === 'external') {
            //     return {
            //         txHash: tx.hash,
            //         from: tx.from,
            //         to: tx.to,
            //         value: tx.value,
            //         decimals: tx.rawContract ? tx.rawContract.decimals : 18,
            //         asset: tx.asset,
            //         tokenAddress: null,
            //         timestamp: tx.metadata.blockTimestamp,
            //         tokenPrice: null,
            //         tokenName: tx.asset === 'MATIC' ? "Polygon" : "Ethereum",
            //     };
            // } else 
            if (!contractAddress) {
                return null;
            }

            contractAddress = contractAddress.toLowerCase();

            const tokenMetadata = metadata.find(m => m.address === contractAddress);
            if (!tokenMetadata) {
                return null;
            }

            return {
                txHash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                decimals: tokenMetadata.decimals ? tokenMetadata.decimals : 18,
                symbol: tokenMetadata.symbol,
                tokenAddress: contractAddress,
                timestamp: tx.metadata.blockTimestamp,
                tokenPrice: null,
                tokenName: tokenMetadata.name,
                chain: tokenMetadata.chain,
                logo: tokenMetadata.logo,
                blockNum: tx.blockNum
            };
        }));

        filteredTxs = filteredTxs.filter(tx => tx !== null);

        const addresses = filteredTxs.map(tx => tx.tokenAddress);

        const tokenPrices = await fetchTokenPrices(addresses);
        filteredTxs.forEach(tx => {
            const address = tx.tokenAddress;
            tx.tokenPrice = tokenPrices[address] ? tokenPrices[address].usd : 0;
            console.log(tx.tokenName, tx.value, tx.tokenPrice, "USD");
        });

        return filteredTxs;
    };

    try {
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
    } catch (error) {
        console.error('Error fetching token transfers:', error);
        return {
            fromTransfers: [],
            toTransfers: [],
        };
    }
}

const metadataCache = new Map();
const validTokenSet = new Set();

async function backwardTokenTransfers(settings, address, startBlock) {
    const alchemy = new Alchemy(settings);
    const validTokenAddresses = await fetchTokenList();
    const metadata = await fetchTokenData();
    
    const initialBatchSize = 1000;
    const maxRetries = 3;
    const baseDelay = 500;
    
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const processTransfers = async (transfers) => {
        if (validTokenSet.size === 0) {
            validTokenAddresses.forEach(addr => validTokenSet.add(addr.toLowerCase()));
        }

        const transfersByContract = new Map();
        transfers.forEach(tx => {
            if (tx.category === 'erc20') {
                const contractAddress = tx.rawContract?.address?.toLowerCase();
                if (contractAddress && validTokenSet.has(contractAddress)) {
                    if (!transfersByContract.has(contractAddress)) {
                        transfersByContract.set(contractAddress, []);
                    }
                    transfersByContract.get(contractAddress).push(tx);
                }
            }
        });

        const processedTransfers = [];
        
        await Promise.all(Array.from(transfersByContract.entries()).map(async ([contractAddress, txs]) => {
            let tokenMetadata = metadataCache.get(contractAddress);
            if (!tokenMetadata) {
                tokenMetadata = metadata.find(m => m.address === contractAddress);
                if (tokenMetadata) {
                    metadataCache.set(contractAddress, tokenMetadata);
                }
            }

            if (tokenMetadata) {
                txs.forEach(tx => {
                    processedTransfers.push({
                        txHash: tx.hash,
                        from: tx.from,
                        to: tx.to,
                        value: tx.value,
                        decimals: tokenMetadata.decimals || 18,
                        symbol: tokenMetadata.symbol,
                        tokenAddress: contractAddress,
                        timestamp: tx.metadata.blockTimestamp,
                        tokenPrice: null,
                        tokenName: tokenMetadata.name,
                        chain: tokenMetadata.chain,
                        logo: tokenMetadata.logo,
                        blockNum: tx.blockNum,
                    });
                });
            }
        }));

        return processedTransfers;
    };

    const fetchRange = async (fromBlock, toBlock, direction) => {
        let retries = 0;
        while (retries < maxRetries) {
            try {
                if (retries > 0) {
                    await sleep(baseDelay * Math.pow(2, retries));
                }
                return await new Promise((resolve, reject) => {
                    semaphore.take(async () => {
                        try {
                            const result = await alchemy.core.getAssetTransfers({
                                fromBlock,
                                toBlock,
                                [direction === 'from' ? 'fromAddress' : 'toAddress']: address,
                                category: ['erc20', 'external'],
                                withMetadata: true,
                                excludeZeroValue: true,
                                maxCount: 100,
                            });
                            resolve(result);
                        } catch (error) {
                            reject(error);
                        } finally {
                            semaphore.leave();
                        }
                    });
                });
            } catch (error) {
                retries++;
                console.error(`Error fetching range (attempt ${retries}):`, error);
                if (retries === maxRetries) return { transfers: [] };
            }
        }
        return { transfers: [] };
    };

    const fetchTransfersBackward = async (direction) => {
        const cacheKey = `${address}-${startBlock}-${direction}`;
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }

        let allTransfers = [];
        let currentBlock = parseInt(startBlock, 16);
        let currentBatchSize = initialBatchSize;
        let iterations = 0;

        while (currentBlock > 0 && iterations < 10 && allTransfers.length < 100) {
            const toBlock = '0x' + currentBlock.toString(16);
            const fromBlock = '0x' + Math.max(currentBlock - currentBatchSize, 0).toString(16);

            const result = await fetchRange(fromBlock, toBlock, direction);
            const transfers = await processTransfers(result.transfers);

            if (transfers.length === 0) {
                iterations++;
                currentBatchSize *= 2;
            } else {
                iterations = 0;
            }

            allTransfers.push(...transfers);
            
            if (allTransfers.length >= 100) {
                allTransfers = allTransfers.slice(0, 100);
                break;
            }

            currentBlock -= currentBatchSize;
            await sleep(baseDelay);
        }

        allTransfers.sort((a, b) => parseInt(b.blockNum, 16) - parseInt(a.blockNum, 16));

        const addresses = allTransfers.map(tx => tx.tokenAddress);
        const tokenPrices = await fetchTokenPrices(addresses);
        allTransfers.forEach(tx => {
            const address = tx.tokenAddress;
            tx.tokenPrice = tokenPrices[address] ? tokenPrices[address].usd : 0;
        });

        cache.set(cacheKey, allTransfers);
        return allTransfers;
    };

    try {
        const [fromTransfers, toTransfers] = await Promise.all([
            fetchTransfersBackward('from'),
            fetchTransfersBackward('to'),
        ]);

        return { fromTransfers, toTransfers };
    } catch (error) {
        console.error('Error fetching backward token transfers:', error);
        return { fromTransfers: [], toTransfers: [] };
    }
}



/** @notice address value is passed here to fetch all to and from transfer of tokens from that address
 * @dev calls the tokenTransfers function for fetching transfers from multiple chains
 * @param req -> req.body.address == the address passed
 */
app.post('/token-transfers', async (req, res) => {
    const address = req.body.address;
    const blockNum = req.body.blockNum || '0x0';
    const isFrom = req.body.isOutgoing !== undefined ? req.body.isOutgoing : true;
    const chain = req.body.chain;
    const chains = {
        eth: settingsEthereum,
        arb: settingsArbitrum,
        opt: settingsOptimism,
        pol: settingsPolygon,
        // zk: settingsZksync,
    };
    const allFromTransfers = [];
    const allToTransfers = [];

    try {
        let selectedChains;
        if (chain && chains[chain]) {
            selectedChains = { [chain]: chains[chain] };
        } else {
            selectedChains = chains;
        }
        // const allTransfers = [];
        if(isFrom) {
            const allTransfers = await Promise.all(Object.values(selectedChains).map(chain => tokenTransfers({apiKey: chain.apiKey, network: chain.network}, address, blockNum)));
            allTransfers.forEach(transfers => {
                allFromTransfers.push(...transfers.fromTransfers);
                allToTransfers.push(...transfers.toTransfers);
            });
        } else {
            const allTransfers = await Promise.all(Object.values(selectedChains).map(chain => backwardTokenTransfers({apiKey: chain.apiKey, network: chain.network}, address, blockNum)));
            allTransfers.forEach(transfers => {
                allFromTransfers.push(...transfers.fromTransfers);
                allToTransfers.push(...transfers.toTransfers);
            });
        }
        
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

// @note Use alchemy__getTokenMetadata instead of using ethers.Contract (?)
/** @notice fetches all internal transfer of tokens in a single transaction
 * @dev fetches tx receipt for a particular tx hash and filters them for ERC-20 transfers
 * @param txHash -> the tx hash for which we are fetching the internal transfers
 * @param providerUrl -> the chain the tx hash belongs to
 * @param settings -> the chain's settings for alchemy-sdk
 */
async function fetchTokenTransfersFromTx(txHash, providerUrl, settings) {
    try {
        const validTokenAddresses = await fetchTokenList();
        metadata = await fetchTokenData();
        const provider = new ethers.JsonRpcProvider(`${providerUrl}`);
        const alchemy = new Alchemy(settings);
        const receipt = await alchemy.core.getTransactionReceipt(txHash);

        if (!receipt) {
            console.log('Transaction not found!');
            return 0;
        }

        const blockNumHex = '0x'+receipt.blockNumber.toString(16);

        console.log(`Found ${receipt.logs.length} logs in the transaction...`);
        
        const tx = await alchemy.core.getTransaction(txHash);
        const decodedTransfers = [];

        if (tx.value > 0) {
            const nativeTransfer = tx.asset === "MATIC" ? {
                from: tx.from,
                to: tx.to,
                value: ethers.formatEther(tx.value._hex),
                tokenName: "Polygon",
                tokenSymbol: "MATIC",
                tokenAddress: null,
                tokenPrice: null,
                blockNum: blockNumHex
            } : {
                from: tx.from,
                to: tx.to,
                value: ethers.formatEther(tx.value._hex),
                tokenName: "Ethereum",
                tokenSymbol: "ETH",
                tokenAddress: null,
                tokenPrice: null,
                blockNum: blockNumHex
            };
            
            // const tokenId = tokenNameToId.find(t => t.name.toLowerCase() === nativeTransfer.tokenName.toLowerCase());
            // if(tokenId) {
            //     const tokenPrice = await fetchTokenPrices([tokenId.id]);
            //     nativeTransfer.tokenPrice = tokenPrice[tokenId.id] ? tokenPrice[tokenId.id].usd : 0;
            // }
            console.log("Native Transfer", nativeTransfer);
            decodedTransfers.push(nativeTransfer);
        }

        const tokenTransfers = receipt.logs.filter(log => log.topics[0] === ERC20_TRANSFER_TOPIC);
        let tokenAddresses = [];
        const decodedTokenTransfers = await Promise.all(tokenTransfers.map(async (log) => {
            if(!validTokenAddresses.has(log.address.toLowerCase())) {
                return {};
            }
            const from = ethers.getAddress(log.topics[1].slice(26));
            const to = ethers.getAddress(log.topics[2].slice(26));
            const value = BigInt(log.data);
            // const contract = new ethers.Contract(log.address, ERC20_ABI, provider);
            // let name = "";
            // let symbol = "";
            // let decimals = 0;
            // try {
            //     name = await contract.name();
            //     symbol = await contract.symbol();
            //     decimals = await contract.decimals();
            // } catch (error) {
            //     console.error(`Error fetching token details for ${log.address}:`, error);
            // }
            const tokenMetadata = metadata.find(m => m.address === log.address.toLowerCase());
            if (!tokenMetadata) {
                return {};
            }
            
            // const tokenId = tokenNameToId.find(t => t.name.toLowerCase() === name.toLowerCase());
            // if(tokenId) {
                const tokenTransfer = {
                    from,
                    to,
                    value: ethers.formatUnits(value, tokenMetadata.decimals),
                    tokenAddress: log.address.toLowerCase(),
                    tokenName: tokenMetadata.name,
                    tokenSymbol: tokenMetadata.symbol,
                    logoURL: tokenMetadata.logo,
                    tokenPrice: 0,
                    blockNum: blockNumHex
                }
                tokenAddresses.push(log.address.toLowerCase());

                return tokenTransfer;
            // } else {
            //     return {};
            // }
        }));

        const filteredTokenTransfers = Object.fromEntries(
            Object.entries(decodedTokenTransfers).filter(([key, value]) => Object.keys(value).length !== 0)
        );

        const tokenPrices = await fetchTokenPrices(tokenAddresses);
        Object.values(filteredTokenTransfers).forEach(transfer => {
            const tokenAddress = transfer.tokenAddress.toLowerCase();
            transfer.tokenPrice = tokenPrices[tokenAddress] ? tokenPrices[tokenAddress].usd : 0;
            //console.log(transfer.tokenName, transfer.value, transfer.tokenSymbol, transfer.tokenPrice, "USD");
        });
        const finalTokenTransfers = Object.values(filteredTokenTransfers).filter(t => Object.keys(t).length);

        return [...decodedTransfers, ...finalTokenTransfers];
    } catch (error) {
        console.error('Error fetching token transfers:', error);
    }
}

/** @notice calls the fetchTokenTransfersFromTx function from different chains
 * @dev will only run for one chain to which the tx hash belongs to, written conditional statements so that it checks for which chain the tx belongs to
 * @param req.body.txhash -> the tx hash for which the transfers need to be fetched
 */
app.post('/fetch-transaction-details', async (req, res) => {
    const txhash = req.body.txhash;

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

const cache_txs = {
    recentTxs: null,
    lastUpdated: 0,
};

/** @notice fetches all txs from the latest block of a chain
 * @dev called for every chain, stores tx details of all ERC-20 and native token transfer txs
 * @param settings -> settings for the chain for which the recent txs are being fetched
 */
async function recentTxs(settings) {
    const cacheDuration = 5 * 60 * 1000;
    const now = Date.now();

    if (cache_txs.recentTxs && (now - cache_txs.lastUpdated < cacheDuration)) {
        console.log("Returning cached transactions");
        return cache_txs.recentTxs;
    }

    try {
        const alchemy = new Alchemy(settings);
        let currentBlock = await alchemy.core.getBlockNumber();
        const validTokenAddresses = await fetchTokenList();
        const metadata = await fetchTokenData();

        let txs = {};
        let filteredTxs;
        for (let i = 0; i < 10; i++) {
            const blockNumber = currentBlock - i;
            if (blockNumber < 0) break;
            
            txs = await alchemy.core.getAssetTransfers({
                fromBlock: blockNumber,
                toBlock: blockNumber,
                category: ['erc20'],
                withMetadata: true,
                excludeZeroValue: true,
                maxCount: 30,
            });
            
            filteredTxs = txs.transfers.filter(tx => {
                if (tx.category === 'erc20') {
                    return validTokenAddresses.has(tx.rawContract.address.toLowerCase());
                }
                return false;
            });
            
            if (filteredTxs.length > 0) {
                break;
            }
        }
        
        const addresses = new Set();
        for (const tx of filteredTxs) {
            
            if (tx.category === 'erc20') {
                const contractAddress = tx.rawContract.address.toLowerCase();

                const tokenMetadata = metadata.find(m => m.address === contractAddress);
                if (!tokenMetadata) return null;

                tx.logo = tokenMetadata.logo;
                addresses.add(contractAddress);
            }
        }

        const tokenPrices = await fetchTokenPrices(addresses);

        for (const tx of filteredTxs) {
            const contractAddress = tx.rawContract.address.toLowerCase();
            if (contractAddress && tokenPrices[contractAddress]) {
                tx.tokenPrice = tokenPrices[contractAddress].usd || 0;
            }
        }

        filteredTxs = filteredTxs.filter(tx => {
            if(tx.tokenPrice) {
                return true;
            } else {
                return false;
            }
        });

        console.log("Txs fetched", settings.network);

        cache_txs.recentTxs = filteredTxs;
        cache_txs.lastUpdated = now;

        return filteredTxs;
    } catch (error) {
        console.error('Error fetching recent transactions:', error);
        return [];
    }
}

/** @notice calls the recentTxs function for multiple chains
 * @dev maps the txs based on the chain and returns the value
 */
app.post('/recent-txs', async (req, res) => {
    try {
        const chains = {
            ethereum: settingsEthereum,
            arbitrum: settingsArbitrum,
            optimism: settingsOptimism,
            polygon: settingsPolygon,
        };
        const allTransfers = await Promise.all(Object.values(chains).map(chain => recentTxs({apiKey: chain.apiKey, network: chain.network})));
        const mergedTransfers = allTransfers.flat();
        console.log(mergedTransfers);
        res.json({txs: mergedTransfers});
    } catch(error) {
        res.status(500).json({ error: 'An error occurred while fetching recent transactions' });
    }
});



/** -----------------------------------------------------------------------------
 * --------------------------- TRENDING TOKENS PAGE -----------------------------
 * --------------------------------------------------------------------------- */

const cache_tokens = {
    data: null,
    lastFetched: 0,
    etag: null
};

/** @notice fetches the top 10 tokens based on market cap
 * @dev fetches the top 10 tokens based on market cap and filters out the EVM tokens
 */
async function getTopTokens() {
    try {
        if (cache_tokens.data && Date.now() - cache_tokens.lastFetched < 5 * 60 * 1000) {
            return cache_tokens.data;
        }

        const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
            params: {
                vs_currency: 'usd',
                order: 'market_cap_desc',
                per_page: 10,
                page: 1
            },
            headers: {
                'If-None-Match': cache_tokens.etag || ''
            }
        });

        if (response.status === 200) {
            cache_tokens.data = response.data;
            cache_tokens.lastFetched = Date.now();
            cache_tokens.etag = response.headers.etag;
            return cache_tokens.data;
        } else if (response.status === 304) {
            return cache_tokens.data;
        }
    } catch (error) {
        console.error("Failed to fetch top EVM tokens:", error);

        if (cache_tokens.data) {
            return cache_tokens.data;
        } else {
            throw new Error('Unable to retrieve top EVM token data.');
        }
    }
}

app.post('/top-tokens', async (req, res) => {
    try {
        const topTokens = await getTopTokens();
        res.json(topTokens);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


/** -----------------------------------------------------------------------------
 * ---------------------------- ALGORAND FUNCTIONS ------------------------------
 * --------------------------------------------------------------------------- */

/**
 * @notice Fetches the token balances for an Algorand address
 * @dev Uses algosdk to fetch the token balances for an Algorand address and avoids NFTs
 * @param address -> the Algorand address for which the token balances are being fetched
 */
async function fetchAlgorandAddressDetails(address) {
    const mainnetClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);

    try {
        if (!algosdk.isValidAddress(address)) {
            throw new Error('Invalid Algorand address');
        }

        const accountInfo = await mainnetClient.lookupAccountByID(address).do();

        const algoBalance = accountInfo.account.amount / BigInt(1e6);

        const assetBalances = accountInfo.account.assets || [];
        console.log('Asset Balances:', assetBalances);

        const coinGeckoCoins = await fetchCoinGeckoCoins();

        const assetDetails = await Promise.all(
            assetBalances.map(async (asset) => {
                try {
                    console.log('Processing Asset:', asset);

                    if (asset.assetId === undefined) {
                        console.warn('Asset ID is undefined or missing, skipping asset.');
                        return null;
                    }

                    const assetInfo = await mainnetClient.lookupAssetByID(asset.assetId).do();

                    if (!assetInfo.asset) {
                        console.warn(`No asset found for ID: ${asset.assetId}`);
                        return null;
                    }

                    const params = assetInfo.asset.params;

                    if (params.total === 1) {
                        console.warn(`Ignoring NFT with ID: ${asset.assetId}`);
                        return null;
                    }

                    const decimals = params.decimals || 0;
                    const rawBalance = asset.amount;
                    const adjustedBalance = rawBalance / BigInt(Math.pow(10, decimals));

                    if (adjustedBalance > 0) {
                        const tokenId = coinGeckoCoins[params.name.toLowerCase()] || coinGeckoCoins[params['unit-name'].toLowerCase()] || null;

                        return {
                            tokenBalance: adjustedBalance.toString(),
                            tokenName: params.name,
                            tokenSymbol: params['unit-name'],
                            tokenId: tokenId,
                            tokenDecimals: decimals,
                            tokenPrice: 0,
                            verified: params.verified || false
                        };
                    }
                    return null;
                } catch (error) {
                    console.error(`Error fetching asset ${asset.assetId}:`, error);
                    return null;
                }
            })
        );

        const validAssets = assetDetails
            .filter(asset => asset !== null)
            .sort((a, b) => parseFloat(b.tokenBalance) - parseFloat(a.tokenBalance));

        const completeBalances = [
            {
                tokenBalance: algoBalance.toString(),
                tokenName: 'Algorand',
                tokenSymbol: 'ALGO',
                tokenId: 0,
                tokenDecimals: 6,
                tokenPrice: 0,
                verified: true
            },
            ...validAssets
        ];

        return completeBalances;
    } catch (error) {
        console.error('Error in fetchAlgorandAddressDetails:', error);
        throw new Error(`Failed to fetch Algorand address details: ${error.message}`);
    }
}

/**
 * @dev calls the fetchAlgorandAddressDetails function for a particular address
 * @param req -> req.body.address == the address passed
 */
app.post('/fetch-algorand-details/:address', async (req, res) => {
    const address = req.body.address;

    if (!address) {
        return res.status(400).json({ error: 'Address is required' });
    }

    try {
        const tokens = await fetchAlgorandAddressDetails(address);
        res.json({ 
            success: true,
            chain: 'algorand',
            tokens 
        });
    } catch (error) {
        console.error('Error fetching Algorand details:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

/// @note add balance history
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});