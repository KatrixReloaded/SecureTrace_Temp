### **Can fetch USD Values like this:**  
  
```javascript
const response = await axios.get('https://api.coingecko.com/api/v3/coins/list');
const tokens = response.data;

// Log the tokens to see their structure
console.log(tokens);
```
    
**OUTPUT**
```json
[
    { "id": "bitcoin", "symbol": "btc", "name": "Bitcoin" },
    { "id": "ethereum", "symbol": "eth", "name": "Ethereum" },
    ...
]

```
  
Get the token's "id" from this api call, pass it instead of the name to fetch the current usd price.  