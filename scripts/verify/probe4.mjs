const q = async (url, query, variables) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) }); return r.json(); };
const S = (o, n = 600) => String(JSON.stringify(o) ?? "undefined").slice(0, n);
const IDX = "https://dev.smk.somnia.host/v1/graphql", PF = "https://price-feed.dev.oracle.somnia.host/v1/graphql";
const feeds = await q(PF, `{ Feed(limit:100){ id decimals latestSpot latestBlockTimestamp } }`);
console.log("A. feeds:", feeds.data?.Feed?.map((f) => `${f.id}(d${f.decimals})`).join(" "));
const from = 1788447600, to = 1788451200;
for (const sym of ["ETH/USDC", "ETH/USDT"]) {
  const c = await q(PF, `query($s:String!,$f:numeric!,$t:numeric!){ Candle(where:{symbol:{_eq:$s}, resolution:{_eq:"M1"}, bucketStart:{_gte:$f,_lte:$t}}, order_by:{bucketStart:asc}, limit:100){ bucketStart open close markClose count } oldest: Candle(where:{symbol:{_eq:$s}, resolution:{_eq:"M1"}}, order_by:{bucketStart:asc}, limit:1){ bucketStart } pts: PricePoint(where:{symbol:{_eq:$s}, blockTimestamp:{_gte:$f,_lte:$t}}, order_by:{blockTimestamp:asc}, limit:1000){ blockTimestamp spot mark } }`, { s: sym, f: from, t: to });
  const d = c.data || {};
  console.log(`   ${sym}: M1 candles in 1h window=${d.Candle?.length} first=${S(d.Candle?.[0])} oldestM1=${S(d.oldest)} pricePoints in window=${d.pts?.length} first=${S(d.pts?.[0])} last=${S(d.pts?.slice(-1)[0])} err=${S(c.errors, 200)}`);
}
const oldestPt = await q(PF, `{ PricePoint(where:{symbol:{_eq:"BTC/USDC"}}, order_by:{blockTimestamp:asc}, limit:1){ blockTimestamp spot } newest: PricePoint(where:{symbol:{_eq:"BTC/USDC"}}, order_by:{blockTimestamp:desc}, limit:1){ blockTimestamp spot } }`);
console.log("   BTC/USDC PricePoint oldest/newest:", S(oldestPt.data));
// B. orders
const mid = "0x0000000000000000000000000000000000000000000000000000000000012563";
for (const [label, where] of [["market:{id}", `{market:{id:{_eq:"${mid}"}}}`], ["market_id", `{market_id:{_eq:"${mid}"}}`], ["owner maker", `{owner:{_eq:"0x94e5a4481bd57f06e959d6d892eed804283135e0"}}`]]) {
  const o = await q(IDX, `{ Order(where:${where}, order_by:{placedAtTimestamp:desc}, limit:3){ orderId market_id owner isBid side price fullQuantity filledQuantity status placedAtTimestamp lastUpdatedAtTimestamp cancelReason } }`);
  console.log(`B. Order where ${label}: n=${o.data?.Order?.length} sample=${S(o.data?.Order?.[0], 400)} err=${S(o.errors, 200)}`);
}
const anyOrder = await q(IDX, `{ Order(order_by:{placedAtTimestamp:desc}, limit:2){ orderId market_id owner status placedAtTimestamp } }`);
console.log("   any recent orders:", S(anyOrder));
