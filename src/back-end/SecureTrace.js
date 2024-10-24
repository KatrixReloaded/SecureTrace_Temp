const express = require('express');
const axios = require('axios');
require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');
const cors = require('cors');
const mysql = require('mysql2/promise');
// const { addOrUpdateTokenPrice } = require('./TokenPricesDB');


/** ----------------------------------------------------------------------------- 
-----------------------------  GLOBAL VARIABLES ---------------------------------
------------------------------------------------------------------------------ */

const app = express();
const port = process.env.PORT || 3001;

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
    origin: '*',  // Allow all origins
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  }));

app.use(express.json());

app.get('/', (req, res) => {
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
async function addOrUpdateTokenPrice(id, tokenPrice) {
    try {
        const connection = await pool.getConnection();  // Get a connection from the pool

        // SQL query with ON DUPLICATE KEY UPDATE for upserting token prices
        const sql = `
            INSERT INTO tokenPrices (id, tokenPrice)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE
                tokenPrice = IF(TIMESTAMPDIFF(MINUTE, createdAt, CURRENT_TIMESTAMP) >= 5, VALUES(tokenPrice), tokenPrice),
                createdAt = IF(TIMESTAMPDIFF(MINUTE, createdAt, CURRENT_TIMESTAMP) >= 5, CURRENT_TIMESTAMP, createdAt)
        `;

        // Execute the query with provided values
        await connection.execute(sql, [id, tokenPrice]);

        connection.release();  // Release the connection back to the pool
    } catch (error) {
        console.error('Error inserting or updating token price:', error);
        throw error;  // Rethrow error to be handled by the caller
    }
}


/** ----------------------------------------------------------------------------- 
 ----------------------------- COMMON FUNCTIONS ---------------------------------
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

/** @dev checks whether the token is a valid/official token and not some bs */
async function fetchTokenList() {
    const connection = await pool.getConnection();
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
        connection.release(); // Ensure the connection is closed
    }
}

/** @notice function to fetch up-to-date token prices
 * @dev returns token prices for tokens whose prices have been updated less than 5 minutes ago
 * @param tokenIds -> set of IDs of tokens for which the USD value is fetched
 */
async function getUpToDateTokenPrices(tokenIds) {
    const connection = await pool.getConnection();

    try {
        if (tokenIds.length === 0) {
            return {};
        }
        const placeholders = tokenIds.map(() => '?').join(',');
        const query = `SELECT id, tokenPrice FROM tokenPrices WHERE id IN (${placeholders}) AND TIMESTAMPDIFF(MINUTE, createdAt, CURRENT_TIMESTAMP) < 5`;

        const [rows] = await connection.execute(query, tokenIds);

        const tokenPrices = {};
        for (const row of rows) {
            tokenPrices[row.id] = { usd: row.tokenPrice };
        }

        return tokenPrices;
    } catch (error) {
        console.error('Error fetching up-to-date token prices:', error);
        return {};
    } finally {
        connection.release();
    }
}

/** @notice Fetches current token price for a set of tokens
 * @dev fetches the current price based on tokenIds set
 * @param tokenIds -> set of IDs of tokens for which the USD value is fetched
 */
async function fetchTokenPrices(tokenIds) {
    const uniqueTokenIds = [...new Set(tokenIds)];

    const upToDatePrices = await getUpToDateTokenPrices(uniqueTokenIds);
    const upToDatePriceIds = upToDatePrices ? new Set(Object.keys(upToDatePrices)) : new Set();

    const idsToFetch = uniqueTokenIds.filter(id => !upToDatePriceIds.has(id));;

    let newPrices = {};
    if (idsToFetch.length > 0) {
        const ids = idsToFetch.join(',');

        try {
            const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);

            // Check if the response status is 429 (rate limit exceeded)
            if (response.status === 429) {
                console.error('Rate limit exceeded. Please wait before making more requests.');
                // Implement a delay before retrying
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
                return fetchTokenPrices(tokenIds);
            }

            if (!response.ok) {
                throw new Error(`Error fetching prices: ${response.statusText}`);
            }

            newPrices = await response.json();

            // Store or update token prices in the database
            for (const [tokenId, priceData] of Object.entries(newPrices)) {
                const price = parseFloat(priceData.usd).toFixed(8);
                await addOrUpdateTokenPrice(tokenId, price);
            }

        } catch (error) {
            console.error('Error fetching token prices:', error);
            return {};
        }
    }

    const allPrices = { ...upToDatePrices, ...newPrices };

    return allPrices;
}



/** @notice function to fetch a token's ID
 * @dev accesses the tokenDB to return id values for respective token names
 */
async function fetchTokenData() {
    const connection = await pool.getConnection();
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
        connection.release();
    }
}


/** ----------------------------------------------------------------------------- 
----------------------------- PORTFOLIO TRACKER ---------------------------------
------------------------------------------------------------------------------ */

/// @note Add native tokens as well
/** @notice fetches the address's ERC-20 token assets
 * @dev uses alchemy-sdk's `getTokenBalances` function to get a particular address's token assets
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

    console.log("TOKEN IDs: ",tokenIds);
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
/** @notice function to fetch all transfers made out from and into the given address
 * @dev calls getAssetTransfers to fetch all transfers made to and from a particular address
 * @dev includes ERC-20 tokens and native tokens
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
                category: ['erc20', 'external'],
                withMetadata: true,
                excludeZeroValue: true,
                maxCount: 100,
            });
        } else {
            transfers = await alchemy.core.getAssetTransfers({
                fromBlock: '0x0',
                toBlock: 'latest',
                toAddress: address,
                category: ['erc20', 'external'],
                withMetadata: true,
                excludeZeroValue: true,
                maxCount: 100,
            });
        }

        return transfers.transfers.filter(tx => {
            if (tx.category === 'erc20') {
                const isValidToken = validTokenAddresses.has(tx.rawContract.address.toLowerCase());
                return isValidToken;
            } else if (tx.category === 'external') {
                return true;
            }
            return false;
        }).map(tx => {
            return {
                txHash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: ethers.formatUnits(tx.value, tx.asset ? tx.asset.decimals : 18),
                asset: tx.asset,
                assetType: tx.category === 'erc20' ? 'ERC20' : 'External',
                tokenAddress: tx.rawContract ? tx.rawContract.address : null,
                timestamp: tx.metadata.blockTimestamp,
                tokenPrice: null,  // Placeholder for token price
                tokenName: null
            };
        });
    };

    // ******CONTINUE HERE******

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


/** @notice address value is passed here to fetch all to and from transfer of tokens from that address
 * @dev calls the tokenTransfers function for fetching transfers from multiple chains
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

/** @notice fetches all internal transfer of tokens in a single transaction
 * @dev fetches tx receipt for a particular tx hash and filters them for ERC-20 transfers
 * @param txHash -> the tx hash for which we are fetching the internal transfers
 * @param providerUrl -> the chain the tx hash belongs to
 * @param settings -> the chain's settings for alchemy-sdk
 */
async function fetchTokenTransfersFromTx(txHash, providerUrl, settings) {
    try {
        const validTokenAddresses = await fetchTokenList();
        tokenNameToId = await fetchTokenData();
        const provider = new ethers.JsonRpcProvider(`${providerUrl}`);
        const alchemy = new Alchemy(settings);
        const receipt = await alchemy.core.getTransactionReceipt(txHash);

        if (!receipt) {
            console.log('Transaction not found!');
            return 0;
        }

        console.log(`Found ${receipt.logs.length} logs in the transaction...`);
        
        const tx = await alchemy.core.getTransaction(txHash);
        const decodedTransfers = [];

        if (tx.value > 0) {
            const nativeTransfer = {
                from: tx.from,
                to: tx.to,
                value: ethers.formatEther(tx.value._hex),
                tokenName: "Ethereum",
                tokenSymbol: "ETH",
                contractAddress: null,
                tokenPrice: null
            };
            
            const tokenId = tokenNameToId.find(t => t.name.toLowerCase() === nativeTransfer.tokenName.toLowerCase());
            if(tokenId) {
                const tokenPrice = await fetchTokenPrices([tokenId.id]);
                nativeTransfer.tokenPrice = tokenPrice[tokenId.id] ? tokenPrice[tokenId.id].usd : 0;
            }
            console.log("Native Transfer", nativeTransfer);
            decodedTransfers.push(nativeTransfer);
        }

        const tokenTransfers = receipt.logs.filter(log => log.topics[0] === ERC20_TRANSFER_TOPIC);
        let tokenIds = [];
        const decodedTokenTransfers = await Promise.all(tokenTransfers.map(async (log) => {
            if(!validTokenAddresses.has(log.address.toLowerCase())) {
                return {};
            }
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
            
            const tokenId = tokenNameToId.find(t => t.name.toLowerCase() === name.toLowerCase());
            if(tokenId) {
                const tokenTransfer = {
                    from,
                    to,
                    value: ethers.formatUnits(value, decimals),
                    contractAddress: log.address,
                    tokenName: name,
                    tokenSymbol: symbol,
                    tokenId: tokenId.id,
                    tokenPrice: 0
                }
                tokenIds.push(tokenTransfer.tokenId);

                return tokenTransfer;
            } else {
                return {};
            }
        }));

        const tokenPrices = await fetchTokenPrices(tokenIds);
        Object.values(decodedTokenTransfers).forEach(transfer => {
            const tokenId = transfer.tokenId;
            transfer.tokenPrice = tokenPrices[tokenId] ? tokenPrices[tokenId].usd : 0;
            console.log(transfer.tokenName, transfer.value, transfer.tokenSymbol, transfer.tokenPrice, "USD");
        });

        return [...decodedTransfers, ...decodedTokenTransfers.filter(t => Object.keys(t).length)];
    } catch (error) {
        console.error('Error fetching token transfers:', error);
    }
}

/** @notice calls the fetchTokenTransfersFromTx function from different chains
 * @dev will only run for one chain to which the tx hash belongs to, written conditional statements so that it checks for which chain the tx belongs to
 * @param req.params.txhash -> the tx hash for which the transfers need to be fetched
 */
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

/** @notice fetches all txs from the latest block of a chain
 * @dev called for every chain, stores tx details of all ERC-20 and native token transfer txs
 * @param settings -> settings for the chain for which the recent txs are being fetched
 */
async function recentTxs(settings) {
    try {
        const alchemy = new Alchemy(settings);
        const validTokenAddresses = await fetchTokenList();
        console.log("Fetching Txs");
        const tokenNameToId = await fetchTokenData();
        const txs = await alchemy.core.getAssetTransfers({
            fromBlock: 'latest',
            category: ['erc20', 'external'],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: 50,
        });

        let tokenIds = [];
        let filteredTxs = txs.transfers.filter(tx => {
            if (tx.category === 'erc20') {
                return validTokenAddresses.has(tx.rawContract.address.toLowerCase());
            } else if (tx.category === 'external') {
                return true;
            }
            return false;
        });

        for (const tx of filteredTxs) {
            if (tx.category === 'erc20') {
                const contractAddress = tx.rawContract.address.toLowerCase();
                const metadata = await alchemy.core.getTokenMetadata(contractAddress);
                const tokenName = metadata?.name?.toLowerCase();
                if (tokenName) {
                    const tokenId = tokenNameToId.find(t => t.name === tokenName);
                    if (tokenId) {
                        tx.tokenId = tokenId.id;
                        tokenIds.push(tokenId.id);
                    }
                }
            } else if (tx.category === 'external') {
                tx.tokenId = "ethereum";
                tokenIds.push("ethereum");
            }
        }

        const tokenPrices = await fetchTokenPrices(tokenIds);

        for (const tx of filteredTxs) {
            if (tx.tokenId && tokenPrices[tx.tokenId]) {
                tx.tokenPrice = tokenPrices[tx.tokenId].usd || 0;
            }
        }

        filteredTxs = filteredTxs.filter(tx => {
            if(tx.tokenPrice) {
                return true;
            } else {
                return false;
            }
        });

        console.log("Txs fetched");
        return filteredTxs;
    } catch (error) {
        console.error('Error fetching recent transactions:', error);
        return [];
    }
}

/** @notice calls the recentTxs function for multiple chains
 * @dev maps the txs based on the chain and returns the value
 */
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