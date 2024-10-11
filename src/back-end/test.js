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

fetchTokenPrices(['ethereum', 'bitcoin', 'dogecoin']).then(prices => {
    console.log(prices);
}).catch(error => {
    console.error('Error:', error);
});