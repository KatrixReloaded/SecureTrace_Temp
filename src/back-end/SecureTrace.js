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
let algoTokenList;


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
async function fetchAlgorandTokenList() {
    const connection = await pool.getConnection();

    try {
        const [rows] = await connection.execute('SELECT chain, address, name, symbol, decimals, price, logoURL FROM TempTokens WHERE chain = "algorand"');
        algoTokenList = rows.map(token => ({
            chain: token.chain,
            address: token.address,
            name: token.name ? token.name : null,
            symbol: token.symbol,
            decimals: token.decimals ? token.decimals : 18,
            price: token.price ? token.price : 0,
            logo: token.logoURL ? token.logoURL : null,
        }));
        return algoTokenList;
    } catch(error) {
        console.error('Error fetching algorand token list from database:', error);
        return [];
    } finally {
        connection.release();
    }
}

async function fetchNativeTokenPrices() {
    const cacheKey = 'nativeTokenPrices';
    const cachedPrices = cache.get(cacheKey);

    if (cachedPrices) {
        console.log('Returning cached prices');
        return cachedPrices;
    }

    try {
        const priceResponse = await axios.get(`https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:matic-network,coingecko:algorand`);
        const prices = priceResponse.data.coins;
        cache.set(cacheKey, prices);
        console.log('Fetched and cached new prices');
        return prices;
    } catch (error) {
        console.error('Error fetching native token prices:', error);
        return null;
    }
}

async function convertURLToBase64(imageUrl) {
    if(!imageUrl) return null;
    try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        return 'data:image/png;base64,' + Buffer.from(response.data, 'binary').toString('base64');
    } catch(error) {
        console.error('Failed to convert image to base64:', error.message);
        return null;
    }
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

    const [validTokenAddresses, metadata, nativeTokenPrices, balances, nativeBalance] = await Promise.all([
        fetchTokenList(),
        fetchTokenData(),
        fetchNativeTokenPrices(),
        alchemy.core.getTokenBalances(address),
        alchemy.core.getBalance(address),
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
                // logo: await convertURLToBase64(tokenMetadata.logo),
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

    // Add native token balance to the token details
    let nativeTokenDetail;
    switch (settings.network) {
        case Network.ETH_MAINNET:
        case Network.ARB_MAINNET:
        case Network.OPT_MAINNET:
        case Network.BLAST_MAINNET:
            nativeTokenDetail = {
                tokenBalance: ethers.formatUnits(nativeBalance.toString(), 18), // Assuming 18 decimals for native token
                tokenName: 'Ethereum',
                tokenSymbol: 'ETH',
                tokenAddress: null,
                tokenPrice: nativeTokenPrices['coingecko:ethereum'].price,
                logo: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
            };
            break;
        case Network.MATIC_MAINNET:
            nativeTokenDetail = {
                tokenBalance: ethers.formatUnits(nativeBalance.toString(), 18), // Assuming 18 decimals for native token
                tokenName: 'Polygon',
                tokenSymbol: 'MATIC',
                tokenAddress: null,
                tokenPrice: nativeTokenPrices['coingecko:matic-network'].price,
                logo: 'https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png',
            };
            break;
        default:
            nativeTokenDetail = null;
    }

    if (nativeTokenDetail) {
        resolvedTokenDetails.push(nativeTokenDetail);
    }

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
async function tokenTransfers(settings, address, fromBlockNum, toBlockNum, tokenList, chainKey) {
    const alchemy = new Alchemy(settings);
    const validTokenAddresses = await fetchTokenList();
    const metadata = await fetchTokenData();
    console.log("Params: ", fromBlockNum, toBlockNum, tokenList);
    const priceData = await fetchNativeTokenPrices();

    const fetchTransfers = async (direction) => {
        let transfers = {};

        let params = {
            fromBlock: fromBlockNum,
            toBlock: toBlockNum,
            category: ['erc20', 'external'],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: 100,
        };

        if (direction === 'from') {
            params.fromAddress = address;
        } else {
            params.toAddress = address;
        }

        if (tokenList !== null) {
            params.contractAddresses = tokenList;
        }

        transfers = await alchemy.core.getAssetTransfers(params);

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
            if(!contractAddress && tx.category === 'external' && tokenList === null) {
                return {
                    txHash: tx.hash,
                    from: tx.from,
                    to: tx.to,
                    value: tx.value,
                    decimals: tx.rawContract ? tx.rawContract.decimals : 18,
                    symbol: tx.asset,
                    tokenAddress: null,
                    timestamp: tx.metadata.blockTimestamp,
                    tokenPrice: tx.asset === 'MATIC' ? priceData['coingecko:matic-network'].price : priceData['coingecko:ethereum'].price,
                    tokenName: tx.asset === 'MATIC' ? "Polygon" : "Ethereum",
                    blockNum: tx.blockNum,
                    chain: chainKey,
                    logo: tx.asset === 'MATIC' ? 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png' : 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
                };
            } else if (!contractAddress) {
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
                chain: chainKey,
                // logo: await convertURLToBase64(tokenMetadata.logo),
                logo: tokenMetadata.logo,
                blockNum: tx.blockNum
            };
        }));

        filteredTxs = filteredTxs.filter(tx => tx !== null);

        const addresses = filteredTxs.map(tx => tx.tokenAddress);

        const tokenPrices = await fetchTokenPrices(addresses);
        filteredTxs.forEach(tx => {
            const address = tx.tokenAddress;
            if(address === null) {
                console.log(tx.tokenName, tx.value, tx.tokenPrice, "USD");
                return;
            }
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

async function backwardTokenTransfers(settings, address, startBlock, tokenList, chainKey) {
    const alchemy = new Alchemy(settings);
    const validTokenAddresses = await fetchTokenList();
    const metadata = await fetchTokenData();
    const priceData = await fetchNativeTokenPrices();
    
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
                txs.forEach(async (tx) => {
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
                        chain: chainKey,
                        // logo: await convertURLToBase64(tokenMetadata.logo),
                        logo: tokenMetadata.logo,
                        blockNum: tx.blockNum,
                    });
                });
            }
        }));

        transfers.forEach(tx => {
            if (tx.category === 'external') {
                let contractAddress = tx.rawContract?.address;
                if (!contractAddress && tokenList === null) {
                    processedTransfers.push({
                        txHash: tx.hash,
                        from: tx.from,
                        to: tx.to,
                        value: tx.value,
                        decimals: tx.rawContract ? tx.rawContract.decimals : 18,
                        symbol: tx.asset,
                        tokenAddress: null,
                        timestamp: tx.metadata.blockTimestamp,
                        tokenPrice: tx.asset === 'MATIC' ? priceData['coingecko:matic-network'].price : priceData['coingecko:ethereum'].price,
                        tokenName: tx.asset === 'MATIC' ? "Polygon" : "Ethereum",
                        blockNum: tx.blockNum,
                        chain: chainKey,
                        logo: tx.asset === 'MATIC' ? 'https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png' : 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
                    });
                }
            }
        });

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
                            let params = {
                                fromBlock,
                                toBlock,
                                [direction === 'from' ? 'fromAddress' : 'toAddress']: address,
                                category: ['erc20', 'external'],
                                withMetadata: true,
                                excludeZeroValue: true,
                                maxCount: 100,
                            };

                            if (tokenList !== null) {
                                params.contractAddresses = tokenList;
                            }

                            const result = await alchemy.core.getAssetTransfers(params);
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

const dateToBlockNum = async (date, settings) => {
    const alchemy = new Alchemy(settings);
    
    const timestamp = Math.floor(date.getTime() / 1000);
    console.log("Timestamp: ", timestamp);

    const getBlockNumberByTimestamp = async (timestamp) => {
        let low = 0;
        let high = await alchemy.core.getBlockNumber();
        let closestBlock = null;
        console.log(`Starting binary search between blocks ${low} and ${high}`);

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const block = await alchemy.core.getBlock(mid);
            console.log(`Checking block ${mid} with timestamp ${block.timestamp}`);

            if (block.timestamp === timestamp) {
                console.log(`Exact match found at block ${mid}`);
                return block;
            } else if (block.timestamp < timestamp) {
                low = mid + 1;
                closestBlock = block;
            } else {
                high = mid - 1;
            }
        }

        console.log(`Closest block found: ${closestBlock.number} with timestamp ${closestBlock.timestamp}`);
        return closestBlock;
    };

    try {
        const block = await getBlockNumberByTimestamp(timestamp);
        if (!block) {
            throw new Error('No block found');
        }
        console.log("Block Number: ", block.number);
        return `0x${block.number.toString(16)}`;
    } catch (error) {
        console.error('Error finding block:', error);
        return '0x0';
    }
};



/** @notice address value is passed here to fetch all to and from transfer of tokens from that address
 * @dev calls the tokenTransfers function for fetching transfers from multiple chains
 * @param req -> req.body.address == the address passed
 */
app.post('/token-transfers', async (req, res) => {
    const address = req.body.address;
    const blockNum = req.body.blockNum ?? '0x0';
    const isFrom = req.body.isOutgoing !== undefined ? req.body.isOutgoing : true;
    const tokenList = req.body.tokenList ?? null;
    const chain = req.body.chain;
    let startDate = req.body.startDate ?? null;
    let endDate = req.body.endDate ?? null;
    
    const chains = {
        ethereum: settingsEthereum,
        arbitrum: settingsArbitrum,
        optimism: settingsOptimism,
        polygon: settingsPolygon,
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

        const dateToBlockNumForChain = async (date, chainSettings) => {
            return await dateToBlockNum(date, chainSettings);
        };

        if (isFrom) {
            const allTransfers = await Promise.all(Object.entries(selectedChains).map(async ([chainName, chainSettings]) => {
                let fromBlockNum = blockNum;
                let toBlockNum = 'latest';

                if (startDate !== null) {
                    console.log(`Start Date for ${chainName}: `, startDate.toString());
                    fromBlockNum = await dateToBlockNumForChain(new Date(startDate.toString()), chainSettings);
                }

                if (endDate !== null) {
                    console.log(`End Date for ${chainName}: `, endDate.toString());
                    toBlockNum = await dateToBlockNumForChain(new Date(endDate.toString()), chainSettings);
                }

                return tokenTransfers(
                    { apiKey: chainSettings.apiKey, network: chainSettings.network },
                    address,
                    fromBlockNum !== null ? fromBlockNum : blockNum,
                    toBlockNum !== null ? toBlockNum : 'latest',
                    tokenList,
                    chainName
                );
            }));

            allTransfers.forEach(transfers => {
                allFromTransfers.push(...transfers.fromTransfers);
                allToTransfers.push(...transfers.toTransfers);
            });
        } else {
            const allTransfers = await Promise.all(Object.entries(selectedChains).map(([chainName, chainSettings]) => backwardTokenTransfers(
                { apiKey: chainSettings.apiKey, network: chainSettings.network },
                address,
                blockNum,
                tokenList,
                chainName
            )));
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

app.post('/fetch-tokens', async (req, res) => {
    const tokenData = await fetchTokenData();
        res.json({ tokens: tokenData });
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
async function fetchTokenTransfersFromTx(txHash, settings) {
    try {
        const validTokenAddresses = await fetchTokenList();
        metadata = await fetchTokenData();
        const alchemy = new Alchemy(settings);
        const receipt = await alchemy.core.getTransactionReceipt(txHash);
        const nativeTokenPrices = await fetchNativeTokenPrices();

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
                tokenPrice: nativeTokenPrices['coingecko:matic-network'].price,
                blockNum: blockNumHex
            } : {
                from: tx.from,
                to: tx.to,
                value: ethers.formatEther(tx.value._hex),
                tokenName: "Ethereum",
                tokenSymbol: "ETH",
                tokenAddress: null,
                tokenPrice: nativeTokenPrices['coingecko:ethereum'].price,
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

            const tokenMetadata = metadata.find(m => m.address === log.address.toLowerCase());
            if (!tokenMetadata) {
                return {};
            }
            
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
        }));

        const filteredTokenTransfers = Object.fromEntries(
            Object.entries(decodedTokenTransfers).filter(([key, value]) => Object.keys(value).length !== 0)
        );

        const tokenPrices = await fetchTokenPrices(tokenAddresses);
        Object.values(filteredTokenTransfers).forEach(transfer => {
            const tokenAddress = transfer.tokenAddress.toLowerCase();
            transfer.tokenPrice = tokenPrices[tokenAddress] ? tokenPrices[tokenAddress].usd : 0;
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

    const addChainNameToTransfers = (transfers, chainName) => {
        return transfers.map(transfer => ({ ...transfer, chain: chainName }));
    };

    try {
        console.log("Fetching internal transfers for Ethereum");
        let ethTransfers = await fetchTokenTransfersFromTx(txhash, settingsEthereum);
        if(ethTransfers !== 0) {
            ethTransfers = addChainNameToTransfers(ethTransfers, 'ethereum');
            res.json({ transfers: ethTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Arbitrum");
        let arbTransfers = await fetchTokenTransfersFromTx(txhash, settingsArbitrum);
        if(arbTransfers !== 0) {
            arbTransfers = addChainNameToTransfers(arbTransfers, 'arbitrum');
            res.json({ transfers: arbTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Polygon");
        let polTransfers = await fetchTokenTransfersFromTx(txhash, settingsPolygon);
        if(polTransfers !== 0) {
            polTransfers = addChainNameToTransfers(polTransfers, 'polygon');
            res.json({ transfers: polTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Optimism");
        let optTransfers = await fetchTokenTransfersFromTx(txhash, settingsOptimism);
        if(optTransfers !== 0) {
            optTransfers = addChainNameToTransfers(optTransfers, 'optimism');
            res.json({ transfers: optTransfers, });
            return;
        }

        console.log("Fetching internal transfers for zkSync");
        let zkTransfers = await fetchTokenTransfersFromTx(txhash, settingsZksync);
        if(zkTransfers !== 0) {
            zkTransfers = addChainNameToTransfers(zkTransfers, 'zksync');
            res.json({ transfers: zkTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Linea");
        let lineaTransfers = await fetchTokenTransfersFromTx(txhash, settingsLinea);
        if(lineaTransfers !== 0) {
            lineaTransfers = addChainNameToTransfers(lineaTransfers, 'linea');
            res.json({ transfers: lineaTransfers, });
            return;
        }

        console.log("Fetching internal transfers for Blast");
        let blastTransfers = await fetchTokenTransfersFromTx(txhash, settingsBlast);
        if(blastTransfers !== 0) {
            blastTransfers = addChainNameToTransfers(blastTransfers, 'blast');
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
const mainnetClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);

async function fetchAlgorandAddressDetails(address) {
    algoTokenList = await fetchAlgorandTokenList();
    const nativeTokenPrices = await fetchNativeTokenPrices();

    try {
        if (!algosdk.isValidAddress(address)) {
            throw new Error('Invalid Algorand address');
        }

        const accountInfo = await mainnetClient.lookupAccountByID(address).do();

        const algoBalance = (BigInt(accountInfo.account.amount) / BigInt(1e6)).toString();

        const assetBalances = accountInfo.account.assets || [];
        console.log('Asset Balances:', assetBalances);

        const assetDetails = await Promise.all(
            assetBalances.map(async (asset) => {
                try {
                    console.log('Processing Asset:', asset);
                    const assetID = (asset.assetId).toString();

                    if (assetID === undefined) {
                        console.warn('Asset ID is undefined or missing, skipping asset.');
                        return null;
                    }

                    const tokenMetadata = algoTokenList.find(m => m.address == assetID);

                    if (!tokenMetadata) {
                        console.warn(`No asset found for ID: ${assetID}`);
                        return null;
                    }

                    const decimals = tokenMetadata.decimals || 0;
                    const rawBalance = BigInt(asset.amount);
                    const adjustedBalance = (rawBalance / BigInt(Math.pow(10, decimals))).toString();

                    if (adjustedBalance > 0) {

                        return {
                            tokenAddress: assetID,
                            tokenBalance: adjustedBalance.toString(),
                            tokenName: tokenMetadata.name,
                            tokenSymbol: tokenMetadata.symbol,
                            tokenDecimals: decimals,
                            tokenPrice: tokenMetadata.price || 0,
                        };
                    }
                    return null;
                } catch (error) {
                    console.error(`Error fetching asset ${assetID}:`, error);
                    return null;
                }
            })
        );

        const validAssets = assetDetails
            .filter(asset => asset !== null)
            .sort((a, b) => parseFloat(b.tokenBalance) - parseFloat(a.tokenBalance));

        const completeBalances = [
            {
                tokenAddress: 0,
                tokenBalance: algoBalance.toString(),
                tokenName: 'Algorand',
                tokenSymbol: 'ALGO',
                tokenDecimals: 6,
                tokenPrice: (nativeTokenPrices['coingecko:algorand'].price).toString(),
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
app.post('/fetch-algorand-details', async (req, res) => {
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

/**
 * @notice Fetches the token transfers made to/from an Algorand address
 * @param address -> the Algorand address for which the token transfers are being fetched
 * @returns an object containing the from and to transfers
 */
async function fetchAlgorandTransfers(address, startDate, endDate, timestamp, isOutgoing) {
    console.log("Address: ", address);
    console.log("Start Date: ", startDate);
    console.log("End Date: ", endDate);
    console.log("Timestamp: ", timestamp);
    console.log("Is Outgoing: ", isOutgoing);
    algoTokenList = await fetchAlgorandTokenList();
    const nativeTokenPrices = await fetchNativeTokenPrices();

    const fetchTransfers = async (direction) => {
        let transactions = [];
        let txns = [];
        let payLen = 0, axferLen = 0;

        try {
            let response;
            if(startDate !== null && endDate !== null) {
                response = await mainnetClient
                    .lookupAccountTransactions(address)
                    .afterTime(startDate)
                    .beforeTime(endDate)
                    .do();
            } else if(timestamp !== null && isOutgoing === true) {
                response = await mainnetClient
                    .lookupAccountTransactions(address)
                    .afterTime(timestamp)
                    .do();
            } else {
                response = await mainnetClient
                    .lookupAccountTransactions(address)
                    .beforeTime(timestamp)
                    .do();
            }

            while (response.transactions.length) {
                transactions = transactions.concat(response.transactions);

                if (response['next-token']) {
                    response = await mainnetClient
                        .lookupAccountTransactions(address)
                        .nextToken(response['next-token'])
                        .do();
                } else {
                    break;
                }
            }
        } catch (error) {
            console.error(`Error fetching ${direction} transactions:`, error);
            return [];
        }

        console.log("Transactions length:", transactions.length);
        transactions.forEach( async (tx) => {
            if (tx.txType === 'pay') {
                payLen++;
                const paymentTxn = tx.paymentTransaction;
                txns.push({
                    txHash: tx.id,
                    from: tx.sender,
                    to: paymentTxn.receiver,
                    value: (Number(paymentTxn.amount) / 1e6),
                    tokenAddress: null,
                    symbol: 'ALGO',
                    decimals: 6,
                    tokenName: 'Algorand',
                    price: nativeTokenPrices['coingecko:algorand'].price.toString(),
                    timestamp: Number(tx.roundTime),
                    blockNum: Number(tx.confirmedRound),
                    chain: 'algorand',
                    logo: 'https://algorand.org/logo.png',
                });
            } else if (tx.txType === 'axfer') {
                axferLen++;
                const assetTransferTransaction = tx.assetTransferTransaction;
                if (!assetTransferTransaction || !assetTransferTransaction.receiver) {
                    console.warn(`Asset transfer transaction missing receiver: ${tx.id}`);
                    return;
                }

                const assetID = assetTransferTransaction.assetId.toString();
                const tokenMetadata = algoTokenList.find(m => m.address == assetID);
        
                if (tokenMetadata) {
                    txns.push({
                        txHash: tx.id,
                        from: tx.sender,
                        to: assetTransferTransaction.receiver,
                        value: (Number((BigInt(assetTransferTransaction.amount) / BigInt(10 ** tokenMetadata.decimals)))),
                        tokenAddress: assetID,
                        symbol: tokenMetadata.symbol,
                        decimals: tokenMetadata.decimals || 0,
                        tokenName: tokenMetadata.name,
                        price: tokenMetadata.price || 0,
                        timestamp: Number(tx.roundTime),
                        blockNum: Number(tx.confirmedRound),
                        chain: 'algorand',
                        // logo: await convertURLToBase64(tokenMetadata.logo) || null,
                        logo: tokenMetadata.logo || null,
                    });
                } else {
                    txns.push({});
                }
            }
        });

        txns = txns.filter((txn) => Object.keys(txn).length > 0);
        console.log(`${direction} Txns length:`, txns.length);
        console.log(`${direction} Pay Length:`, payLen, ` Axfer Length:`, axferLen);

        return txns;
    };

    try {
        const transfers = await fetchTransfers('to');

        return {
            transfers
        };
    } catch (error) {
        console.error('Error fetching Algorand transfers:', error);
        return {
            fromTransfers: [],
            toTransfers: [],
        };
    }
}



/**
 * @notice POST function to fetch the token transfers for an Algorand address
 * @dev calls the fetchAlgorandTransfers function for a particular address
 * @param req -> req.body.address == the address passed
 * @param req -> req.body.timestamp == the timestamp after which the transfers executed are being fetched
 * @param req -> req.body.isOutgoing == the direction of the transfers
 * @param req -> req.body.startDate == the start date for the transfers
 * @param req -> req.body.endDate == the end date for the transfers
 * @returns res -> the response containing the from and to transfers
 */
app.post('/algo-transfers', async (req, res) => {
    const address = req.body.address;
    let timestamp = req.body.timestamp ?? 0;
    const isOutgoing = req.body.isOutgoing !== undefined ? req.body.isOutgoing : true;
    let startDate = req.body.startDate ?? 0;
    let endDate = req.body.endDate ?? 4294967295000;

    try {
        if(isOutgoing && timestamp !== 0) {
            timestamp = new Date(timestamp*1000).toISOString();
            
            const transfers = await fetchAlgorandTransfers(address, null, null, timestamp, isOutgoing);
            
            res.json(transfers);
        } else if(isOutgoing) {
            startDate = new Date(startDate).toISOString();
            endDate = new Date(endDate).toISOString();
            
            const transfers = await fetchAlgorandTransfers(address, startDate, endDate, null, isOutgoing);
            
            res.json(transfers);
        } else {
            const transfers = await fetchAlgorandTransfers(address, null, null, timestamp, isOutgoing);
            
            res.json(transfers);
        }
    } catch (error) {
        console.error('Error fetching algorand transfers: '. error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @notice Fetches the details of transfers made in a single transaction using the transaction ID
 * @param txId -> the transaction ID for which the details are being fetched
 * @returns an object containing the transaction details
*/
async function fetchAlgorandTransactionDetails(txId) {
    try {
        const txInfo = await mainnetClient.lookupTransactionByID(txId).do();
        const nativeTokenPrices = await fetchNativeTokenPrices();
        const algoTokenList = await fetchAlgorandTokenList();
        
        if (!txInfo) {
            throw new Error('Transaction not found');
        }
        
        const txDetails = [];
        const tx = txInfo.transaction;
        
        const processTransaction = async (transaction) => {
            if (transaction.txType === 'pay') {
                const paymentTxn = transaction.paymentTransaction;
                txDetails.push({
                    txHash: transaction.id,
                    from: transaction.sender,
                    to: paymentTxn.receiver,
                    value: (Number(paymentTxn.amount) / 1e6),
                    tokenAddress: null,
                    symbol: 'ALGO',
                    decimals: 6,
                    tokenName: 'Algorand',
                    price: nativeTokenPrices['coingecko:algorand'].price.toString(),
                    timestamp: Number(transaction.roundTime),
                    blockNum: Number(transaction.confirmedRound),
                    chain: 'algorand',
                    logo: 'https://algorand.org/logo.png',
                });
            } else if (transaction.txType === 'axfer') {
                const assetTransferTransaction = transaction.assetTransferTransaction;
                if (!assetTransferTransaction || !assetTransferTransaction.receiver) {
                    console.warn(`Asset transfer transaction missing receiver: ${transaction.id}`);
                    return;
                }
                
                const assetID = assetTransferTransaction.assetId.toString();
                const tokenMetadata = algoTokenList.find(m => m.address == assetID);
                
                if (tokenMetadata) {
                    txDetails.push({
                        txHash: transaction.id,
                        from: transaction.sender,
                        to: assetTransferTransaction.receiver,
                        value: (Number((BigInt(assetTransferTransaction.amount) / BigInt(10 ** tokenMetadata.decimals)))),
                        tokenAddress: assetID,
                        symbol: tokenMetadata.symbol,
                        decimals: tokenMetadata.decimals || 0,
                        tokenName: tokenMetadata.name,
                        price: tokenMetadata.price || 0,
                        timestamp: Number(transaction.roundTime),
                        blockNum: Number(transaction.confirmedRound),
                        chain: 'algorand',
                        // logo: await convertURLToBase64(tokenMetadata.logo) || null,
                        logo: tokenMetadata.logo || null,
                    });
                }
            }
        };
        
        processTransaction(tx);
        
        if (tx.innerTxns) {
            tx.innerTxns.forEach(innerTx => processTransaction(innerTx));
        }
        
        return txDetails;
    } catch (error) {
        console.error('Error fetching Algorand transaction details:', error);
        throw new Error(`Failed to fetch Algorand transaction details: ${error.message}`);
    }
}

/**
 * @notice POST function to fetch the details of transfers made in a single transaction using the transaction ID
 * @param req -> req.body.txId == the transaction ID passed
 * @returns res -> the response containing the transaction details
*/
app.post('/algo-transaction-details', async (req, res) => {
    const txId = req.body.txId;
    
    if (!txId) {
        return res.status(400).json({ error: 'Transaction ID is required' });
    }
    
    try {
        const txDetails = await fetchAlgorandTransactionDetails(txId);
        res.json(txDetails);
    } catch (error) {
        console.error('Error fetching Algorand transaction details:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

/**
 * @notice Fetches the Algorand Smart Contract details to verify existence
 * @param appId -> the Algorand Smart Contract ID
 */
async function isAppExisting(appId) {
    const apiUrl = `https://mainnet-idx.algonode.cloud/v2/applications/${appId}`;

    try {
        const response = await fetch(apiUrl);

        if (response.ok) {
            return true;
        } else if (response.status === 404) {
            return false;
        } else {
            console.error("Unexpected response:", response.statusText);
            return false;
        }
    } catch (error) {
        console.error("Error checking application existence:", error.message);
        return false;
    }
}

/**
 * @notice Fetches the Algorand Smart Contract credit score
 * @param appId -> the Algorand Smart Contract ID
 */
async function fetchAlgoAppCreditScore(appId) {
    let creditScore = 0;

    try {
        const currentRound = Number((await mainnetClient.makeHealthCheck().do()).round);
        const fromRound = Math.max(currentRound - 1728000, 0);

        const appTxnsResponse = await mainnetClient
            .searchForTransactions()
            .applicationID(appId)
            .minRound(fromRound)
            .do();

        const transactions = appTxnsResponse.transactions;

        const uniqueCallers = new Set();
        let successTx = 0;

        transactions.forEach((txn) => {
            if (txn.txType === "appl" && txn.applicationTransaction.onCompletion === "noop") {
                successTx++;
                uniqueCallers.add(txn.sender);
            }
        });

        const successPc = (successTx / transactions.length) * 100;

        const isVerified = await isAppExisting(appId);
        const vfStatus = isVerified ? "Verified" : "Unverified";

        const diversityScore = Math.min(uniqueCallers.size / 500, 1);

        console.log(`Success Percentage: ${successPc}%`);
        console.log(`Verification Status: ${vfStatus}`);
        console.log("Diversity Score: ", diversityScore);

        creditScore += (successPc / 100) * 0.33;
        if (vfStatus === "Verified") {
            creditScore += 0.33;
        }
        creditScore += diversityScore * 0.34;

        creditScore = creditScore * 1000;

        if (creditScore > 999) {
            creditScore--;
        }
        
        console.log("Credit Score: ", creditScore);
        return {
            creditScore: creditScore,
            successPc: successPc,
            verificationStatus: vfStatus,
            diversityScore: diversityScore,
        };
    } catch (error) {
        console.error("Failed to fetch App Credit score details: ", error);
        return {
            success: false,
            message: error.message,
        };
    }
}

/**
 * @notice POST function to fetch the Algorand Smart Contract credit score
 * @param req -> req.body.address == the address passed
 * @returns res -> the response containing the credit score
 */
app.post('/algo-sc-credit-score', async (req, res) => {
    const appId = req.body.address;

    try {
        const creditScore = await fetchAlgoAppCreditScore(appId);
        res.json(creditScore);
    } catch(error) {
        console.error('Error fetching Algorand SC credit score: ', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @notice Fetches the Algorand Wallet credit score
 * @param walletAddress -> the Algorand Wallet address
 */
async function fetchAlgoWalletCreditScore(walletAddress) {
    let creditScore = 0;

    try {
        const currentRound = Number((await mainnetClient.makeHealthCheck().do()).round);
        const fromRound = Math.max(currentRound - 1728000, 0);

        const accountInfo = await mainnetClient.lookupAccountByID(walletAddress).do();
        const txHistoryResponse = await mainnetClient
            .searchForTransactions()
            .address(walletAddress)
            .minRound(fromRound)
            .do();

        const transactions = txHistoryResponse.transactions;

        const balance = Number(accountInfo.account.amount) || 0;
        const totalTxCount = transactions.length;
        const uniqueInteractions = new Set();
        let successfulTx = 0;
        let recentTxCount = 0;

        const appsCreated = accountInfo.account['created-apps']?.length || 0;
        const appsOptedIn = accountInfo.account['apps-local-state']?.length || 0;
        const assetsHeld = accountInfo.account.assets?.length || 0;

        transactions.forEach((txn) => {
            if (txn.confirmedRound) {
                successfulTx++;
                uniqueInteractions.add(txn.sender === walletAddress ? txn.receiver : txn.sender);

                if (txn.confirmedRound >= currentRound - 30000) {
                    recentTxCount++;
                }
            }
        });

        const txSuccessRate = totalTxCount > 0 ? (successfulTx / totalTxCount) * 100 : 0;
        const interactionDiversity = Math.min(uniqueInteractions.size / 100, 1);
        const recentActivityScore = Math.min(recentTxCount / 50, 1);

        const balanceScore = Math.min(Math.log10(balance / 1e6 + 1) / 3, 1);

        console.log(`Balance: ${balance / 1e6} Algos`);
        console.log(`Balance Score: ${balanceScore}`);
        console.log(`Transaction Success Rate: ${txSuccessRate}%`);
        console.log(`Interaction Diversity Score: ${interactionDiversity}`);
        console.log(`Recent Activity Score: ${recentActivityScore}`);
        console.log(`Apps Created: ${appsCreated}`);
        console.log(`Apps Opted Into: ${appsOptedIn}`);
        console.log(`Assets Held: ${assetsHeld}`);

        creditScore += (txSuccessRate / 100) * 0.2;
        creditScore += balanceScore * 0.1;
        creditScore += interactionDiversity * 0.25;
        creditScore += recentActivityScore * 0.15;
        creditScore += Math.min(appsCreated / 10, 1) * 0.1;
        creditScore += Math.min(appsOptedIn / 50, 1) * 0.1;
        creditScore += Math.min(assetsHeld / 20, 1) * 0.1;

        creditScore = Math.min(999, Math.floor(creditScore * 1000));

        console.log("Wallet Credit Score: ", creditScore);

        return creditScore;
    } catch (error) {
        console.error("Failed to fetch Wallet Credit Score details: ", error);
        return {
            success: false,
            message: error.message,
        };
    }
}

/**
 * @notice POST function to fetch the Algorand Wallet credit score
 * @param req -> req.body.address == the address passed
 * @returns res -> the response containing the credit score
 */
app.post('/algo-wallet-credit-score', async (req, res) => {
    const address = req.body.address;
    
    try {
        const creditScore = await fetchAlgoWalletCreditScore(address);
        res.json(creditScore);
    } catch (error) {
        console.error('Error fetching Algorand wallet credit score: ', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/** -----------------------------------------------------------------------------
 * -------------------------- CREDIT SCORE FUNCTIONS ----------------------------
 * --------------------------------------------------------------------------- */

async function fetchWalletCreditScore(address) {
    try {
        const res = await axios.get(
            `https://beta.credprotocol.com/api/score/address/${address}`,
            {
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                Authorization: `Token ${process.env.CRED_APIKEY}`,
            },
            }
        );

        return res.data;
    } catch(error) {
        console.error('Error fetching wallet credit score: ', error);
        return {
            success: false,
            message: error.message,
        };
    }
}

app.post('/wallet-credit-score', async (req,res) => {
    const address=req.body.address;

    try {
        const credit_score = await fetchWalletCreditScore(address);
        res.json(credit_score.value);
    } catch (error) {
        console.error('Error fetching wallet credit score: '. error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

async function checkContractVerification(address, apiKey, scannerUrl) {
    const url = `${scannerUrl}?module=contract&action=getabi&address=${address}&apikey=${apiKey}`;

    try {
        const response = await axios.get(url);
        const data = await response.data;

        return data.status === "1";
    } catch (error) {
        console.error("Error checking contract verification status:", error.message);
        return false;
    }
}

async function fetchSCCreditScore(address, apiKey, scannerUrl, settings) {
    const alchemy = new Alchemy(settings);
    let transfers;
    let creditScore = 0;

    try {
        const currentBlock = await alchemy.core.getBlockNumber();
        const fromBlock = currentBlock - 201600;
        let fromTransfers = await alchemy.core.getAssetTransfers({
            fromAddress: address,
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: 'latest',
            category: ['erc20', 'erc721', 'external'],
        });
        let toTransfers = await alchemy.core.getAssetTransfers({
            toAddress: address,
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: 'latest',
            category: ['erc20', 'erc721', 'external'],
        });

        const uniqueToAddresses = new Set();
        fromTransfers = (fromTransfers.transfers || []).filter((transfer) => {
            if (!transfer.to || uniqueToAddresses.has(transfer.to)) {
                return false;
            }
            uniqueToAddresses.add(transfer.to);
            return true;
        });
        const uniqueFromAddresses = new Set();
        toTransfers = (toTransfers.transfers || []).filter((transfer) => {
            if (!transfer.from || uniqueFromAddresses.has(transfer.from)) {
                return false;
            }
            uniqueFromAddresses.add(transfer.from);
            return true;
        });
        transfers = [...fromTransfers, ...toTransfers];

        let successTx = 0, failureTx = 0, unknownTx = 0;

        const BATCH_SIZE = 10;
        for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
            const batch = transfers.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (transfer) => {
                if (transfer.hash) {
                    try {
                        const receipt = await alchemy.core.getTransactionReceipt(transfer.hash);
                        if (receipt.status === 1) {
                            transfer.receipt_status = 'Success';
                            successTx++;
                        } else {
                            transfer.receipt_status = 'Failure';
                            failureTx++;
                        }
                    } catch (error) {
                        transfer.receipt_status = 'Unknown';
                        unknownTx++;
                        console.error(`Error fetching receipt for hash ${transfer.hash}:`, error.message);
                    }
                } else {
                    transfer.receipt_status = 'Unknown';
                }
            }));
        }
        const successPc = (successTx / (successTx + failureTx + unknownTx)) * 100;

        const verificationStatus = await checkContractVerification(address, apiKey, scannerUrl);
        const vfStatus = verificationStatus ? "Verified" : "Unverified";

        console.log(`Success Percentage: ${successPc}%`);
        console.log(`Verification Status: ${vfStatus}`);
        
        creditScore += (successPc/100)*0.33;
        if(vfStatus === "Verified") {
            creditScore += 0.33;
        }
        const diversity_score = Math.min((uniqueFromAddresses.size + uniqueToAddresses.size)/100, 1);
        console.log("Diversity Score: ", diversity_score);
        creditScore += diversity_score * 0.34;
        

        creditScore = creditScore * 1000;

        if(creditScore > 999) {
            creditScore--;
        }
        return {
            creditScore: creditScore,
            successPc: successPc,
            verificationStatus: vfStatus,
            diversityScore: diversity_score,
        };
    } catch (error) {
        console.error("Failed to fetch SC Credit score details: ", error);
        return {
            success: false,
            message: error.message,
        };
    }
}

app.post('/sc-credit-score', async (req,res) => {
    const address = req.body.address;
    const chain = req.body.chain;
    console.log("Address: ", address);
    console.log("Chain: ", chain);

    const chains = {
        ethereum: settingsEthereum,
        arbitrum: settingsArbitrum,
        optimism: settingsOptimism,
        polygon: settingsPolygon,
    };

    const apiKeys = {
        ethereum: process.env.ETHERSCAN_APIKEY,
        arbitrum: process.env.ARBISCAN_APIKEY,
        optimism: process.env.OPTIMISTIC_APIKEY,
        polygon: process.env.POLYGONSCAN_APIKEY,
    }

    const scannerUrl = {
        ethereum: "https://api.etherscan.io/api",
        arbitrum: "https://api.arbiscan.io/api",
        optimism: "https://api-optimistic.etherscan.io/api",
        polygon: "https://api.polygonscan.com/api",
    }

    try {
        const credit_score = await fetchSCCreditScore(address, apiKeys[chain], scannerUrl[chain], chains[chain]);
        res.json(credit_score);
    } catch (error) {
        console.error('Error fetching smart contract credit score: '. error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});