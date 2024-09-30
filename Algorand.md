# Algorand API Set-up  
  
### **For fetching all to and from transfers**
```javascript
const fetch = require('node-fetch');

const address = 'YOUR_ALGORAND_ADDRESS';
const indexerUrl = `https://testnet-api.algonode.cloud/v2/transactions?address=${address}`;

fetch(indexerUrl)
    .then(response => response.json())
    .then(data => {
        const transactions = data.transactions;
        const transfers = transactions.filter(tx => tx['type'] === 'pay' || tx['type'] === 'axfer'); // 'pay' for Algo transfers, 'axfer' for ASA transfers
        
        console.log(transfers);
    })
    .catch(error => {
        console.error('Error fetching data:', error);
    });
```
  
### **For fetching assets**  
  
```javascript
const fetch = require('node-fetch');

const address = 'YOUR_ALGORAND_ADDRESS';
const indexerUrl = `https://testnet-api.algonode.cloud/v2/accounts/${address}`;

fetch(indexerUrl)
    .then(response => response.json())
    .then(data => {
        console.log(data);
    })
    .catch(error => {
        console.error('Error fetching data:', error);
    });
```
  
### **For fetching transfers in a tx**  
  
```javascript
const fetch = require('node-fetch');

const transactionId = 'YOUR_TRANSACTION_ID'; // Replace with your transaction ID
const indexerUrl = `https://testnet-api.algonode.cloud/v2/transactions/${transactionId}`;

fetch(indexerUrl)
    .then(response => response.json())
    .then(data => {
        const transaction = data.transaction;
        
        // Check if it's a transfer
        if (transaction.type === 'pay' || transaction.type === 'axfer') {
            console.log('Transaction Details:', transaction);
            // Extract relevant details
            if (transaction.type === 'pay') {
                console.log(`ALGO Transfer: Amount ${transaction.amount} from ${transaction.from} to ${transaction.to}`);
            } else if (transaction.type === 'axfer') {
                console.log(`ASA Transfer: Asset ID ${transaction.assetIndex} from ${transaction.from} to ${transaction.to}`);
            }
        } else {
            console.log('No transfer found for this transaction.');
        }
    })
    .catch(error => {
        console.error('Error fetching data:', error);
    });
```