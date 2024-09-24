const axios = require('axios');
async function fetchTokenIds() {
    try {
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/list');
        const tokens = response.data;
        console.log(tokens);
        console.log(tokens.map(token => token.id)); 
    } catch (error) {
        console.error('Error fetching token list:', error);
        return new Set(); 
    }
}

fetchTokenIds();