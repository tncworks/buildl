import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
const pub = createPublicClient({ transport: http("https://dream-rpc.somnia.network") });
const tusdc = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
for (const a of ["0x94e5a4481bd57f06e959d6d892eed804283135e0", "0x21672CBD023751B59e737dD1647E53dCFb4490e0", "0xe11825b13c96ccbe49cff978932375ce13daaeb4", "0x296222944949ea99dc801cdc5bf9edc77a652c07"]) {
  const [stt, t] = await Promise.all([pub.getBalance({ address: a }), pub.readContract({ address: tusdc, abi: erc20Abi, functionName: "balanceOf", args: [a] })]);
  const api = await fetch(`http://localhost:3210/api/wallet?address=${a}`).then((r) => r.json());
  console.log(a.slice(0, 10), "rpc stt", formatUnits(stt, 18), "tusdc", formatUnits(t, 6), "| api stt", api.stt, "tusdc", api.tusdc, Number(api.stt) === Number(formatUnits(stt, 18)) && Number(api.tusdc) === Number(formatUnits(t, 6)) ? "MATCH" : "MISMATCH");
}
