const algosdk = require('algosdk');

const getAlgorandTransactions = async () => {
  const indexerClient = new algosdk.Indexer('', 'https://algoindexer.algoexplorerapi.io', '');

  const response = await indexerClient.searchForTransactions().limit(10).do();
  return response.transactions.map(tx => ({
    chain: 'Algorand',
    hash: tx.id,
    from: tx.sender,
    to: tx['payment-transaction'] ? tx['payment-transaction'].receiver : 'N/A',
    value: tx['payment-transaction'] ? tx['payment-transaction'].amount : 'N/A',
    timestamp: tx['round-time'],
  }));
};
