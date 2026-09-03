import { createPublicClient, http, toFunctionSelector, keccak256, toHex } from "viem";
import { SOMNIA_TESTNET_ADDRESSES, SOMNIA_MAINNET_ADDRESSES } from "@somnia-chain/markets-sdk";
const probes = [
  ["testnet", "https://dream-rpc.somnia.network", 50312],
  ["testnet-infra", "https://api.infra.testnet.somnia.network", 50312],
  ["mainnet", "https://api.infra.mainnet.somnia.network", 5031],
];
console.log("SDK testnet addresses:", SOMNIA_TESTNET_ADDRESSES);
console.log("SDK mainnet addresses:", SOMNIA_MAINNET_ADDRESSES);
const sel = (sig) => toFunctionSelector(sig);
const wanted = { "faucet(uint256)": sel("faucet(uint256)"), "faucet()": sel("faucet()"), "decimals()": sel("decimals()") };
for (const [name, url, chainId] of probes) {
  const c = createPublicClient({ transport: http(url) });
  try {
    const id = await c.getChainId(); const bn = await c.getBlockNumber(); const gas = await c.getGasPrice();
    console.log(`\n[${name}] ${url} chainId=${id} (expect ${chainId}) block=${bn} gasPrice=${Number(gas)/1e9} gwei`);
    const addrs = name.startsWith("testnet") ? SOMNIA_TESTNET_ADDRESSES : SOMNIA_MAINNET_ADDRESSES;
    for (const [k, a] of Object.entries(addrs)) {
      if (typeof a !== "string" || !a.startsWith("0x") || a.length !== 42) continue;
      const code = await c.getCode({ address: a });
      const has = Object.entries(wanted).filter(([, s]) => code && code.includes(s.slice(2))).map(([n]) => n);
      console.log(`  ${k.padEnd(28)} ${a} code=${code ? code.length/2 - 1 : 0}B ${has.length ? "selectors:" + has.join(",") : ""}`);
    }
  } catch (e) { console.log(`\n[${name}] FAILED: ${e.shortMessage || e.message}`); }
}
