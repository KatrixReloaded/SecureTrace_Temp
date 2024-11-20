const { Alchemy, Network } = require('alchemy-sdk');
require('dotenv').config();

const settings = {
    apiKey: process.env.ALCHEMY_APIKEY,
    network: Network.ETH_MAINNET, // Replace with the appropriate network
};

const alchemy = new Alchemy(settings);

async function getBlockNumberByDate(date) {
    const targetTimestamp = Math.floor(new Date(date).getTime() / 1000); // Convert date to Unix timestamp

    let low = 0;
    let high = await alchemy.core.getBlockNumber();
    let closestBlock = null;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const block = await alchemy.core.getBlock(mid);

        if (block.timestamp === targetTimestamp) {
            return mid;
        } else if (block.timestamp < targetTimestamp) {
            low = mid + 1;
            closestBlock = block;
        } else {
            high = mid - 1;
        }
    }

    return closestBlock ? closestBlock.number : null;
}

// Example usage
const userDate = '2022-01-01T00:00:00Z'; // Replace with user-provided date
getBlockNumberByDate(userDate).then(blockNumber => {
    console.log(`Block number closest to ${userDate}:`, blockNumber);
});