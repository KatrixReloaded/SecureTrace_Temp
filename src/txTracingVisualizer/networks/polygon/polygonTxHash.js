require('dotenv').config();
const { Alchemy, Network } = require('alchemy-sdk');
const { ethers } = require('ethers');

const settings = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.MATIC_MAINNET,
};

const alchemy = new Alchemy(settings); // Replace with your Alchemy API key
const provider = new ethers.JsonRpcProvider(`https://polygon-mainnet.g.alchemy.com/v2/${settings.apiKey}`); // Same API key for provider

const transactionHash = '0xb861e6fde20908d3ba0cbb3ed439dc9edc0a389a138210ce9ba7ddfd2b9dee46';
const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)"
];

async function getTokenDetails(provider, contractAddress) {
    const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
    try {
        const name = await contract.name();
        const symbol = await contract.symbol();
        return { name, symbol };
    } catch (error) {
        console.error(`Error fetching token details for ${contractAddress}:`, error);
        return { name: 'Unknown', symbol: 'Unknown' }; // Fallback in case of error
    }
}

async function fetchTokenTransfersFromTx(txHash) {
    try {
        // Fetch the transaction receipt using Alchemy SDK
        const receipt = await alchemy.core.getTransactionReceipt(txHash);
        
        if (!receipt) {
            console.error('Transaction not found!');
            return;
        }

        console.log(`Found ${receipt.logs.length} logs in the transaction...`);

        const tokenTransfers = receipt.logs.filter(log => log.topics[0] === ERC20_TRANSFER_TOPIC);

        // Process the token transfers
        const decodedTransfers = await Promise.all(tokenTransfers.map(async (log) => {
            const from = ethers.getAddress(log.topics[1].slice(26));
            const to = ethers.getAddress(log.topics[2].slice(26));
            const value = BigInt(log.data);
            const contract = new ethers.Contract(log.address, ERC20_ABI, provider);
            let name = "";
            let symbol = "";
            try {
                name = await contract.name();
                symbol = await contract.symbol();
            } catch (error) {
                console.error(`Error fetching token details for ${log.address}:`, error);
            }

            return {
                from,
                to,
                value: ethers.formatUnits(value, 18), // Assuming token with 18 decimals
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

// Example usage:
fetchTokenTransfersFromTx(transactionHash).then(transfers => {
    console.log('All Token Transfers from Polygon Transaction:', transfers);
});
