import { Connection } from '@solana/web3.js';

export const getSolanaTransactions = async (limit = 10) => {
  const connection = new Connection('https://solana-mainnet.g.alchemy.com/v2/839iazADCxidHD9gK3oi9NAvfzs5RR19');

  // Step 1: Get the latest blockhash
  const slot = await connection.getSlot();

  // Step 2: Get block signatures using the blockhash
  const blockSignatures = await connection.getBlockSignatures(slot);
  let limitedSignatures = [];
  for(let i = blockSignatures.signatures.length-1; limitedSignatures.length <= 10; i--) {
    const tx = await connection.getParsedTransaction(blockSignatures.signatures[i], {maxSupportedTransactionVersion: 0, commitment: 'confirmed'});
    const txInstructions = tx.transaction.message.instructions;
    txInstructions.forEach((instruction) => {
      if ((instruction.parsed && instruction.parsed.type === 'transfer') || (instruction.parsed && instruction.parsed.type === 'transferChecked')) {
        limitedSignatures.push(blockSignatures.signatures[i]);
      }
    })
  }

  // Step 3: Fetch transaction details for each signature
  const transactions = await Promise.all(
    limitedSignatures.map(async(signature) => {
      const tx = await connection.getParsedTransaction(signature, {maxSupportedTransactionVersion: 0, commitment: 'confirmed'});
      const message = tx.transaction.message;
      const txInstructions = message.instructions;

      let fromAddress = "";
      let toAddress = "";
      let amount = 'N/A';
      txInstructions.forEach((instruction)=> {
        const parsedInstruction = instruction.parsed;
        if (parsedInstruction && parsedInstruction.type === 'transfer') {
            fromAddress = parsedInstruction.info.source;
            toAddress = parsedInstruction.info.destination;
            amount = parsedInstruction.info.amount;
        } 
        else if (parsedInstruction && parsedInstruction.type === 'transferChecked') {
            fromAddress = parsedInstruction.info.source;
            toAddress = parsedInstruction.info.destination;
            amount = parsedInstruction.info.tokenAmount.uiAmount;
        }
      });

      console.log(amount);

      const solanaTxs = {
        chain: 'Solana',
        hash: signature,
        from: fromAddress.toString(),
        to: toAddress.toString(),
        value: amount !== undefined ? (amount/1_000_000_000) : 0,  // Solana doesn't display direct value like Ethereum
        timestamp: tx.blockTime,  // Transaction timestamp
      };
      return solanaTxs;
    })
  );

  return transactions;
};
