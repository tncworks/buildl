const q = async (url, query, variables) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) }); return r.json(); };
const IDX = "https://dev.smk.somnia.host/v1/graphql", PF = "https://price-feed.dev.oracle.somnia.host/v1/graphql";
for (const [name, url] of [["indexer", IDX], ["pricefeed", PF]]) {
  const s = await q(url, `{ __schema { queryType { fields { name } } } }`);
  const names = s.data?.__schema?.queryType?.fields?.map((f) => f.name) || [];
  console.log(`\n### ${name} root query fields (${names.length}):`, names.filter((n) => !n.endsWith("_by_pk") && !n.endsWith("_aggregate")).join(" "));
  if (s.errors) console.log("errors:", JSON.stringify(s.errors).slice(0, 300));
}
// indexer Order type fields
const t = await q(IDX, `{ __type(name: "Order") { fields { name type { name kind ofType { name } } } } }`);
console.log("\n### indexer Order fields:", t.data?.__type?.fields?.map((f) => `${f.name}:${f.type.name || f.type.ofType?.name}`).join(" "));
// can we query orders by pool + time without owner?
const pool = "0x171186a2a8d237ad194dd3cae9b05326407c4e11";
const o = await q(IDX, `query($pool:String!){ Order(where:{pool:{_eq:$pool}}, order_by:{placedAtTimestamp:desc}, limit:3){ id market pool owner isBid price fullQuantity filledQuantity status placedAtTimestamp expireTimestampNs rested } }`, { pool });
console.log("\n### Order by pool (no owner):", JSON.stringify(o).slice(0, 900));
// order status update / cancel timestamps?
const t2 = await q(IDX, `{ __type(name: "OrderStatusUpdate") { fields { name } } }`);
console.log("\n### OrderStatusUpdate fields:", t2.data?.__type?.fields?.map((f) => f.name).join(" ") || JSON.stringify(t2).slice(0, 200));
// price feed tables
for (const tn of ["PriceTick", "Price", "PriceCandle", "Candle", "price_tick", "prices"]) {
  const tt = await q(PF, `{ __type(name: "${tn}") { name fields { name type { name ofType { name } } } } }`);
  if (tt.data?.__type) console.log(`\n### pricefeed type ${tn}:`, tt.data.__type.fields.map((f) => `${f.name}:${f.type.name || f.type.ofType?.name}`).join(" "));
}
