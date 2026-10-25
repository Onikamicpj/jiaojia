# 数据源可抓性实测

2026-10-25 实测，地点中国大陆家宽，带正常浏览器 UA + `Accept-Language`，非代理。

结论先放这：**日本模型站能稳定抓的只有 BanzaiHobby**，其他要么 Cloudflare 403，要么前端渲染。

## 总表

| 站点 | 结果 | 说明 |
|---|---|---|
| [BanzaiHobby](https://banzaihobby.com) | ✅ 200，可用 | Shopify 站，`/collections/bandai-gunpla/products.json` 直接给结构化数据，含价格、库存、标签。约 2500 个 SKU，10 页拉完 |
| [万代官方 bandai-hobby.net](https://bandai-hobby.net) | ⚠️ 302 | 商品页会跳 `/mente/`，需要正确的 item id，未深挖。官方定价目前人工维护 |
| [AmiAmi](https://www.amiami.com) | ❌ 403 | 带 UA 也是 403，Cloudflare 人机校验 |
| [骏河屋 suruga-ya.jp](https://www.suruga-ya.jp) | ❌ 403 | 同上 |
| [Hobby Search 1999.co.jp](https://www.1999.co.jp) | ❌ 无价 | 页面 200、225KB，但商品列表是前端渲染，HTML 里 `円` 出现 0 次 |
| [HLJ](https://www.hlj.com) | ❌ 无价 | 搜索页 200、209KB，但列表由 JS 加载，只有静态提示文案 |
| [Mandarake](https://www.mandarake.co.jp) | ✅ 200 | 可访问，未做解析。中古专门店，可作为后续源 |
| 淘宝 / 拼多多 / 闲鱼 | ❌ 不碰 | 无开放价格接口，反爬强，抓取属灰色地带。走人工 CSV |

## BanzaiHobby 用法

```
GET https://banzaihobby.com/collections/bandai-gunpla/products.json?limit=250&page=1
```

- `limit` 最大 250，`page` 从 1 开始，返回空数组即结束
- 价格在 `variants[0].price`，字符串，单位日元
- 库存看 `available`
- 中古品在 `tags` 里含 `Preloved`
- 另有 `bandai-plamo-market`（878 件）、`banzai-plamo-collection`（16339 件）两个更大的集合

### 坑

1. **有货率只有 11%**。2411 件里 269 件 `available: true`。这是个二手/代购性质的站，大量商品挂着历史价但没货。
2. **限定版极多**。透明版、电镀版、Gundam Base 限定、会场限定、一番赏、7-11 联名，标题都长得像，价格差 3~10 倍。必须过滤，否则「最低价」直接失真。
3. **标题经常不写比例**。`Bandai RG RX-0 Unicorn Gundam` 里没有 `1/144`，如果拿比例当必匹配项会漏掉一半。
4. **等级必须严格校验**。只匹配 `unicorn` 会抓到水贴（`Gundam Decal`）、HGUC 的杰刚（`(UNICORN Ver.)`）、以及其他机体。

## 给后来者

如果要补日本新品源，优先级建议：

1. **Mandarake** —— 已确认可访问，HTML 结构老派，中古价参考价值高
2. **万代官网** —— 把 item id 规则摸清楚，就能拿到最权威的官方定价，省掉人工维护
3. 其他站建议直接放弃 HTML 抓取，考虑官方联盟 API 或付费数据服务
