# SecureTrace  
### A Blockchain Forensics Tool to track crypto assets and transactions  
  
**Set up two variables in .env in the root directory**  
- ETHERSCAN_APIKEY  
- ALCHEMY_APIKEY  
- DB_HOST  
- DB_USER  
- DB_PASS  
- DB_NAME  
  
**Then run**  
```bash
npm i
source .env
sudo systemctl start mariadb
node src/back-end/SecureTrace.js
npm start
```  
  
**Endpoints**  
- `/fetch-address-details` for fetching holdings of an address  
- `/token-transfers/:address` for fetching to and from transfer of tokens of an address  
- `/fetch-transaction-details/:txhash` for fetching all token transfers that occurred in a transaction  
- `/recent-txs` for fetching latest txs across multiple chains  
- `/top-tokens` for fetching top EVM based tokens by market cap  
- `/fetch-algorand-details/:address` for fetching holdings of an Algorand address  
