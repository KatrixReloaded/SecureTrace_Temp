import axios from 'axios';

export const getEthereumTransactions = async() => {
  const apiKey = 'D7T3JSPM38H94YS6J37RKZD2GXSS8RCKTG';
  const latestBlockUrl = `https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${apiKey}`;
  const blockResponse = await axios.get(latestBlockUrl);
  const latestBlock = blockResponse.data.result;

  const transactionsUrl = `https://api.etherscan.io/api?module=proxy&action=eth_getBlockByNumber&tag=${latestBlock}&boolean=true&apikey=${apiKey}`;
  const transactionsResponse = await axios.get(transactionsUrl);
  const ethTxs = transactionsResponse.data.result.transactions.slice(0,10).map(tx => ({
    chain: 'Ethereum',
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: (parseInt(tx.value, 16)) / Math.pow(10,18),
    timestamp: latestBlock.timestamp,
    tokenName: tx.tokenName,
    tokenSymbol: tx.tokenSymbol,
  }
  ));
  return ethTxs;
};