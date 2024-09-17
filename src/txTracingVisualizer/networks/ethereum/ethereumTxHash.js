const axios = require('axios');

// Etherscan API key
const API_KEY = 'D7T3JSPM38H94YS6J37RKZD2GXSS8RCKTG';

// Transaction hash you want to fetch token transfers for
const transactionHash = 'YourTransactionHashHere';

// Etherscan API endpoints for different token types
const ERC20_URL = `https://api.etherscan.io/api?module=account&action=tokentx&txhash=${transactionHash}&apikey=${API_KEY}`;
const ERC721_URL = `https://api.etherscan.io/api?module=account&action=tokennfttx&txhash=${transactionHash}&apikey=${API_KEY}`;
const ERC1155_URL = `https://api.etherscan.io/api?module=account&action=token1155tx&txhash=${transactionHash}&apikey=${API_KEY}`;

// Function to fetch token transfers
async function fetchTokenTransfers() {
    try {
        // Fetch ERC-20 transfers
        const erc20Response = await axios.get(ERC20_URL);
        const erc20Transfers = erc20Response.data.result;
        console.log('ERC-20 Token Transfers:', erc20Transfers);

        // Fetch ERC-721 transfers
        const erc721Response = await axios.get(ERC721_URL);
        const erc721Transfers = erc721Response.data.result;
        console.log('ERC-721 (NFT) Token Transfers:', erc721Transfers);

        // Fetch ERC-1155 transfers
        const erc1155Response = await axios.get(ERC1155_URL);
        const erc1155Transfers = erc1155Response.data.result;
        console.log('ERC-1155 Token Transfers:', erc1155Transfers);

        // Combine all token transfers for further processing or saving
        const allTransfers = {
            erc20: erc20Transfers,
            erc721: erc721Transfers,
            erc1155: erc1155Transfers
        };

        return allTransfers;
    } catch (error) {
        console.error('Error fetching token transfers:', error);
    }
}

// Call the function to fetch token transfers
fetchTokenTransfers().then(transfers => {
    console.log('All Token Transfers:', transfers);
});
