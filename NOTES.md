### **Can optimize Address Visualizer like this:**  
  
```javascript
async function tokenTransfers(settings, address) {
    const alchemy = new Alchemy(settings);
    const validTokenAddresses = await fetchTokenList();

    const fetchTransfers = async (direction) => {
        const transfers = await alchemy.core.getAssetTransfers({
            fromBlock: '0x0',
            toBlock: 'latest',
            [direction === 'from' ? 'fromAddress' : 'toAddress']: address,
            category: ['erc20'],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: 100,
        });

        return transfers.transfers.filter(tx => {
            if (tx.category === 'erc20') {
                return validTokenAddresses.has(tx.rawContract.address.toLowerCase());
            } else if (tx.category === 'external') {
                return true;
            }
            return false;
        });
    };

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
}

// Usage for multiple chains
async function fetchAllTransfersForChains(chains, address) {
    const allTransfers = await Promise.all(chains.map(chain => tokenTransfers(chain.settings, address)));
    return allTransfers;
}
```