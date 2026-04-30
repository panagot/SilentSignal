export const ETH_SEPOLIA_CHAIN_ID = 11155111

export const DEFAULT_SETTLEMENT_ADDRESS =
  import.meta.env.VITE_SETTLEMENT_CONTRACT_ADDRESS ?? ''

export const INTENT_SETTLEMENT_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'owner_', type: 'address' },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'maker', type: 'address' },
      { indexed: true, internalType: 'address', name: 'solver', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'nonce', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amountInWei', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'amountOutTokens', type: 'uint256' },
    ],
    name: 'IntentFilled',
    type: 'event',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'intentHash', type: 'bytes32' },
      { internalType: 'uint256', name: 'nonce', type: 'uint256' },
      { internalType: 'uint256', name: 'expiry', type: 'uint256' },
    ],
    name: 'lockIntent',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'maker', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'maxInputWei', type: 'uint256' },
          { internalType: 'uint256', name: 'minOutputTokens', type: 'uint256' },
          { internalType: 'uint256', name: 'expiry', type: 'uint256' },
          { internalType: 'uint256', name: 'nonce', type: 'uint256' },
          { internalType: 'bool', name: 'allowPartial', type: 'bool' },
        ],
        internalType: 'struct IntentSettlement.Intent',
        name: 'intent',
        type: 'tuple',
      },
      { internalType: 'uint256', name: 'amountInWei', type: 'uint256' },
      { internalType: 'uint256', name: 'amountOutTokens', type: 'uint256' },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'fillIntent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'maker', type: 'address' },
          { internalType: 'address', name: 'tokenOut', type: 'address' },
          { internalType: 'uint256', name: 'maxInputWei', type: 'uint256' },
          { internalType: 'uint256', name: 'minOutputTokens', type: 'uint256' },
          { internalType: 'uint256', name: 'expiry', type: 'uint256' },
          { internalType: 'uint256', name: 'nonce', type: 'uint256' },
          { internalType: 'bool', name: 'allowPartial', type: 'bool' },
        ],
        internalType: 'struct IntentSettlement.Intent',
        name: 'intent',
        type: 'tuple',
      },
    ],
    name: 'hashIntentStruct',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'pure',
    type: 'function',
  },
]
