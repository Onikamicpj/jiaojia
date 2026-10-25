# 数据源可抓性实测

2026-10-25 实测，地点中国大陆家宽，带正常浏览器 UA + `Accept-Language`，非代理。

结论先放这：**日本模型站能稳定抓的只有 BanzaiHobby**，其他要么 Cloudflare 403，要么前端渲染。

## 总表

| 站点 | 结果 | 说明 |
|---|---|---|
| [BanzaiHobby](https://banzaihobby.com) | ✅ 可用 | Shopify 站，两个接口都通：目录 `collections/bandai-gunpla/products.json`（约 2500 SKU），单品 `products/{handle}.json`（实时价+库存，约 1.4s） |
| [万代官方 bandai-hobby.net](https://bandai-hobby.net) | ⚠️ 302 | 商品页会跳 `/mente/`，需要正确的 item id，未深挖。官方定价目前人工维护 |
| [AmiAmi](https://www.amiami.com) | ❌ 403 | 带 UA 也是 403，Cloudflare 人机校验 |
| [骏河屋 suruga-ya.jp](https://www.suruga-ya.jp) | ❌ 403 | 同上 |
| [Hobby Search 1999.co.jp](https://www.1999.co.jp) | ❌ 无价 | 页面 200、225KB，但商品列表是前端渲染，HTML 里 `円` 出现 0 次 |
| [HLJ](https://www.hlj.com) | ❌ 无价 | 搜索页 200、209KB，但列表由 JS 加载，只有静态提示文案 |
| [Mandarake](https://www.mandarake.co.jp) | ✅ 200 | 可访问，未做解析。中古专门店，可作为后续源 |

## 国内电商：全线封死

| 尝试 | 结果 |
|---|---|
| 拼多多 H5 `mobile.yangkeduo.com/search_result.html` | 200 / 48KB，React 空壳，`"price"` 出现 0 次 |
| 拼多多 `proxy/api/search` | `{"error_code":40001}` —— 缺 `anti_content` 参数，由对方 JS 混淆算法实时生成 |
| 拼多多 + 无头 Edge 渲染（12s） | DOM 里只剩「登录」两个字 |
| 京东 `search.jd.com` | 302，跟随跳转后仅 957 字节拦截页 |
| 京东 `item.jd.com/xxx.html` | curl 8191 字节拦截页；无头 Edge 渲染后直接是登录页 |
| 京东 `p.3.cn/prices/mgets` | 空响应 |
| 什么值得买 `search.smzdm.com` | 202，209 字节，反爬 |
| Bing `www.bing.com/search` | 200 但无 cookie 时结果全是无关站（搜商品词返回一堆抖音），纯文本仅 1433 字符，`¥` 出现 0 次 |
| DuckDuckGo HTML 版 | 连接失败 |

**结论：国内电商必须登录态，无法程序化取实时价。** 任何声称能抓的脚本，要么依赖已登录的 cookie（随时失效），要么返回的是过期的导购文价格。

## BanzaiHobby 的搜索接口不能用

`suggest.json` 的模糊匹配质量极差：搜 `RG 1/144 Nu Gundam` 返回超合金、吉翁号、异端、铁奥，`limit=40` 只回 6 条且全无关。

所以本项目放弃搜索接口，改成：**自己维护目录 + 本地精确匹配 + 单品接口实时确认价格**。

### 坑

1. **有货率本来只有 11%**（2411 件里 269 件），但单品接口查到的实时库存可能已经补货，不能只信目录。
2. **限定版极多**。透明版、电镀版、Gundam Base 限定、会场限定、一番赏、7-11 联名，标题都长得像，价格差 3~10 倍。必须过滤，否则「最低价」直接失真。
3. **标题经常不写比例**。`Bandai RG RX-0 Unicorn Gundam` 里没有 `1/144`，拿比例当必匹配项会漏掉一半。比例要由等级（RG/MG/PG）反推。
4. **等级必须严格校验**。只匹配 `unicorn` 会抓到水贴（`Gundam Decal`）、HGUC 的杰刚（`(UNICORN Ver.)`）、以及其他机体。


## 给后来者

如果要补日本新品源，优先级建议：

1. **Mandarake** —— 已确认可访问，HTML 结构老派，中古价参考价值高
2. **万代官网** —— 把 item id 规则摸清楚，就能拿到最权威的官方定价，省掉人工维护
3. 其他站建议直接放弃 HTML 抓取，考虑官方联盟 API 或付费数据服务
