const q = async (url, query, variables) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) }); return r.json(); };
const IDX = "https://dev.smk.somnia.host/v1/graphql", PF = "https://price-feed.dev.oracle.somnia.host/v1/graphql";
const S = (o, n = 700) => String(JSON.stringify(o) ?? "undefined").slice(0, n);
// 1. Orders by market_id (book reconstruction)
const mid = "0x0000000000000000000000000000000000000000000000000000000000012563";
const o = await q(IDX, `query($m:String!){ Order(where:{market_id:{_eq:$m}}, order_by:{placedAtTimestamp:asc}, limit:400){ orderId owner isBid side price fullQuantity filledQuantity quantityRemaining status rested cancelReason placedAtTimestamp lastUpdatedAtTimestamp expireTimestampNs } Order_aggregate(where:{market_id:{_eq:$m}}){ aggregate{ count } } }`, { m: mid });
const orders = o.data?.Order || [];
console.log("1. Orders for market:", orders.length, "agg:", S(o.data?.Order_aggregate), "errors:", S(o.errors));
console.log("   statuses:", JSON.stringify(orders.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})), "sides:", JSON.stringify(orders.reduce((a, r) => (a[r.side] = (a[r.side] || 0) + 1, a), {})));
console.log("   sample:", S(orders[0]), "\n   sample2:", S(orders.find((r) => r.status !== orders[0].status)));
// 2. Price feed history
const pp = await q(PF, `{ __type(name: "PricePoint") { fields { name type { name ofType { name } } } } Feed: __type(name:"Feed"){ fields { name } } }`);
console.log("\n2. PricePoint fields:", pp.data?.__type?.fields?.map((f) => `${f.name}:${f.type.name || f.type.ofType?.name}`).join(" "));
console.log("   Feed fields:", pp.data?.Feed?.fields?.map((f) => f.name).join(" "));
const feeds = await q(PF, `{ Feed(limit:10){ id symbol } Symbol(limit:10){ id } }`);
console.log("   feeds:", S(feeds));
const from = 1788447600, to = 1788451200; // the ETH 3600s window
const c1 = await q(PF, `query($f:numeric!,$t:numeric!){ Candle(where:{symbol:{_eq:"ETH"}, resolution:{_eq:"M1"}, bucketStart:{_gte:$f,_lte:$t}}, order_by:{bucketStart:asc}, limit:100){ bucketStart open high low close markClose count } }`, { f: from, t: to });
console.log("   ETH M1 candles in window:", c1.data?.Candle?.length, "first:", S(c1.data?.Candle?.[0]), "last:", S(c1.data?.Candle?.slice(-1)[0]), "errors:", S(c1.errors));
const oldest = await q(PF, `{ Candle(where:{symbol:{_eq:"BTC"}, resolution:{_eq:"M1"}}, order_by:{bucketStart:asc}, limit:1){ bucketStart } newest: Candle(where:{symbol:{_eq:"BTC"}, resolution:{_eq:"M1"}}, order_by:{bucketStart:desc}, limit:1){ bucketStart } Candle_aggregate(where:{symbol:{_eq:"BTC"}, resolution:{_eq:"M1"}}){ aggregate{ count } } }`);
console.log("   BTC M1 history: oldest", S(oldest.data?.Candle), "newest", S(oldest.data?.newest), "count", S(oldest.data?.Candle_aggregate), "errors:", S(oldest.errors));
const ticks = await q(PF, `query($f:numeric!,$t:numeric!){ PricePoint(where:{symbol:{_eq:"ETH"}, timestamp:{_gte:$f,_lte:$t}}, order_by:{timestamp:asc}, limit:5){ timestamp price } PricePoint_aggregate(where:{symbol:{_eq:"ETH"}, timestamp:{_gte:$f,_lte:$t}}){ aggregate{ count } } }`, { f: from, t: to });
console.log("   ETH PricePoints in 1h window:", S(ticks));
// 3. pagination depth of past markets
const deep = await q(IDX, `{ Market(where:{marketType:{_eq:"BINARY"}, asset:{_eq:"BTC"}, intervalSec:{_eq:300}}, order_by:{expiry:desc}, limit:1, offset:3000){ id expiry } Market_aggregate(where:{marketType:{_eq:"BINARY"}, asset:{_eq:"BTC"}, intervalSec:{_eq:300}, status:{_eq:"Finalized"}}){ aggregate{ count } } }`);
console.log("\n3. BTC/300s finalized count + row at offset 3000:", S(deep));
const byVenue = await q(IDX, `{ Market(where:{marketType:{_eq:"BINARY"}, status:{_eq:"Finalized"}}, distinct_on:[venueId], limit:20){ venueId } }`);
console.log("   distinct venues with finalized:", S(byVenue));
for (const v of ["0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c", "0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f"]) {
  const r = await q(IDX, `query($v:String!){ Market_aggregate(where:{marketType:{_eq:"BINARY"}, venueId:{_eq:$v}, status:{_eq:"Finalized"}}){ aggregate{ count } } traded: Market_aggregate(where:{marketType:{_eq:"BINARY"}, venueId:{_eq:$v}, status:{_eq:"Finalized"}, tradeCount:{_gt:0}}){ aggregate{ count } } byInt: Market(where:{marketType:{_eq:"BINARY"}, venueId:{_eq:$v}}, distinct_on:[intervalSec]){ intervalSec asset } }`, { v });
  console.log(`   venue ${v.slice(0, 10)}: finalized=${r.data?.Market_aggregate?.aggregate?.count} traded=${r.data?.traded?.aggregate?.count} intervals=${S(r.data?.byInt, 300)} err=${S(r.errors, 200)}`);
}
// 4. closing answer on an older venue-0x6797 300s market
const older = await q(IDX, `{ Market(where:{marketType:{_eq:"BINARY"}, venueId:{_eq:"0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c"}, intervalSec:{_eq:300}, status:{_eq:"Finalized"}, tradeCount:{_gt:0}}, order_by:{expiry:desc}, limit:3, offset:5){ id expiry winningOutcome tradeCount } }`);
const ids = older.data?.Market?.map((m) => m.id) || [];
const ans = await q(IDX, `query($ids:[String!]){ MarketReferenceLink(where:{market_id:{_in:$ids}}){ market_id oracleQuestionId pending } OracleBindByMarket(where:{market_id:{_in:$ids}}, limit:5){ market_id } }`, { ids });
console.log("\n4. older 0x6797 300s markets:", S(older.data), "\n   ref links:", S(ans));
const oa = await q(IDX, `{ __type(name:"OracleAnswer"){ fields { name } } OracleBindByMarket: __type(name:"OracleBindByMarket"){ fields { name } } }`);
console.log("   OracleAnswer fields:", oa.data?.__type?.fields?.map((f) => f.name).join(" "), "| OracleBindByMarket:", oa.data?.OracleBindByMarket?.fields?.map((f) => f.name).join(" "));
