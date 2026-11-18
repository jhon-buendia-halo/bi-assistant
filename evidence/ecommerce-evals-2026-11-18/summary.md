| Target | 3 of 3 | flaky | 0 of 3 | dev | held-out | attempts | run errors | median s | total $ | $ per question |
|---|---|---|---|---|---|---|---|---|---|---|
| Emily | 27/100 | 25 | 48 | 16/67 | 11/33 | 118/300 | 0 | 9.4 | $0.63 | $0.0063 |
| Workflow | 21/100 | 16 | 63 | 14/67 | 7/33 | 85/300 | 0 | 22.7 | $1.04 | $0.0104 |

| Category | Questions | Emily 3 of 3 | Workflow 3 of 3 |
|---|---|---|---|
| join | 13 | 6 | 4 |
| ranking | 11 | 0 | 0 |
| ratio | 11 | 3 | 1 |
| aggregate | 16 | 2 | 4 |
| reasoning | 9 | 0 | 0 |
| fuzzy-scope | 4 | 1 | 0 |
| encoding | 5 | 4 | 3 |
| null | 5 | 3 | 4 |
| lookup | 3 | 2 | 2 |
| discovery | 3 | 0 | 0 |
| ambiguous | 5 | 5 | 0 |
| out-of-scope | 4 | 0 | 2 |
| non-existent | 3 | 1 | 1 |
| visual | 3 | 0 | 0 |
| paraphrase | 5 | 0 | 0 |

Emily: failed attempts by check
- result-set-match: 145 attempts, 58 questions: ec-a-best-subcategory-per-department, ec-a-damage-by-carrier, ec-a-do-vips-order-more, ec-a-electronics-customers-delivered, ec-a-eur-delivered-revenue, ec-a-gbp-aov-by-tier …
- check-matches: 72 attempts, 30 questions: ec-a-do-vips-order-more, ec-a-electronics-customers-delivered, ec-a-eur-delivered-revenue, ec-a-is-damage-top-return-reason, ec-a-most-five-star-products-ties, ec-a-return-rate-by-department …
- check-numbers-grounded: 13 attempts, 7 questions: ec-d-fedex-delivery-days-reworded, ec-d-nonexistent-warehouse, ec-d-oos-marketing-spend, ec-d-oos-revenue-2019, ec-d-oos-stock-march-2026, ec-d-top-brands-units-reworded …
- check-not-matches: 10 attempts, 4 questions: ec-c-legacy-distinct-orders, ec-d-oos-marketing-spend, ec-d-oos-revenue-2019, ec-d-oos-website-visits
- check-called-tool: 5 attempts, 4 questions: ec-a-is-damage-top-return-reason, ec-b-discount-vs-order-value, ec-b-shipped-before-ordered, ec-c-gift-card-revenue
- check-no-tool-errors: 5 attempts, 4 questions: ec-a-damage-by-carrier, ec-b-line-return-rate-2024-vs-2025, ec-c-vip-customers-split, ec-d-return-rate-2023
- check-no-html: 5 attempts, 2 questions: ec-c-discover-order-info, ec-c-discover-product-catalogue
- check-no-repairs: 3 attempts, 3 questions: ec-d-fedex-delivery-days, ec-d-nonexistent-product, ec-d-oos-marketing-spend
- check-did-not-call: 2 attempts, 1 questions: ec-c-discover-customer-info
- check-includes: 2 attempts, 1 questions: ec-d-return-rate-2023

Workflow: failed attempts by check
- result-set-match: 169 attempts, 63 questions: ec-a-avg-rating-by-department, ec-a-best-subcategory-per-department, ec-a-cancellation-rate-by-channel, ec-a-damage-by-carrier, ec-a-do-vips-order-more, ec-a-electronics-customers-delivered …
- check-matches: 108 attempts, 42 questions: ec-a-avg-rating-by-department, ec-a-damage-by-carrier, ec-a-do-vips-order-more, ec-a-electronics-customers-delivered, ec-a-eur-delivered-revenue, ec-a-gbp-aov-by-tier …
- check-called-tool: 66 attempts, 27 questions: ec-a-damage-by-carrier, ec-a-do-vips-order-more, ec-a-eur-delivered-revenue, ec-a-gbp-aov-by-tier, ec-a-is-damage-top-return-reason, ec-b-discount-vs-order-value …
- check-numbers-grounded: 18 attempts, 9 questions: ec-d-fedex-delivery-days, ec-d-nonexistent-product, ec-d-nonexistent-warehouse, ec-d-oos-revenue-2019, ec-d-oos-stock-march-2026, ec-d-return-rate-2023 …
- check-includes: 10 attempts, 4 questions: ec-b-returns-by-top-category-2025, ec-c-quote-in-product-name, ec-d-return-rate-2023, ec-d-return-rate-2023-reworded
- check-did-not-call: 9 attempts, 3 questions: ec-c-discover-customer-info, ec-c-discover-order-info, ec-c-discover-product-catalogue
- check-tool-order: 9 attempts, 3 questions: ec-d-visual-monthly-orders-2025, ec-d-visual-payment-method-value, ec-d-visual-returns-by-reason
- check-visual-keywords: 9 attempts, 3 questions: ec-d-visual-monthly-orders-2025, ec-d-visual-payment-method-value, ec-d-visual-returns-by-reason
- check-no-tool-errors: 8 attempts, 6 questions: ec-a-returned-orders-payment-method, ec-a-undelivered-in-transit, ec-a-usd-average-order-value, ec-c-discover-order-info, ec-d-return-rate-2023, ec-d-top-brands-units-reworded
- check-not-matches: 4 attempts, 2 questions: ec-c-legacy-distinct-orders, ec-d-oos-revenue-2019
- check-no-html: 3 attempts, 1 questions: ec-c-discover-order-info
- check-no-repairs: 1 attempts, 1 questions: ec-d-warehouse-low-stock-reworded
- check-qualified-names: 1 attempts, 1 questions: ec-d-oos-revenue-2019

Questions failing on both (0 of 3 on each):
- `ec-a-returned-orders-payment-method` (join): For orders that ended up returned, how were they paid for? Give the number of returned orders per payment meth
- `ec-a-top-brands-delivered` (ranking): What are our top 3 brands by number of items sold on delivered orders?
- `ec-a-most-five-star-products-ties` (ranking): Which product has received the most 5-star reviews? If several are tied, name all of them.
- `ec-a-best-subcategory-per-department` (ranking): In each main department, which sub-category sells the most items? Count the sub-sub-categories inside their su
- `ec-a-top-customers-delivered-orders` (ranking): Who are our most loyal customers by number of delivered orders? Name the top customer and everyone tied in sec
- `ec-a-return-rate-by-department` (ratio): Which main department has the highest return rate, measured as returned items out of items sold?
- `ec-a-usd-average-order-value` (ratio): What is our average order value for orders paid in US dollars, leaving out orders that were cancelled or retur
- `ec-a-gbp-aov-by-tier` (ratio): In British pounds, which customer tier has the highest average order value? Leave out cancelled orders.
- `ec-a-refunds-by-reason` (aggregate): How much money have we refunded for each return reason?
- `ec-a-eur-delivered-revenue` (aggregate): What is our total revenue in euros from delivered orders?
- `ec-a-units-delivered-clean` (aggregate): How many units have we actually delivered to customers? Ignore order lines with zero or negative quantities.
- `ec-a-is-damage-top-return-reason` (reasoning): Is product damage really our biggest reason for returns, or is it just one reason among many?
- `ec-a-do-vips-order-more` (reasoning): Do our VIP customers actually order more often than everyone else?
- `ec-a-is-2026-volume-down` (reasoning): Are we getting fewer orders in 2026 than in 2025?
- `ec-a-undelivered-in-transit` (reasoning): We have shipments with no delivery date. Are those just recent parcels still on their way?
- `ec-b-returns-within-30-days` (aggregate): How many returned items came back within 30 days of the order being placed?
- `ec-b-cohort-2024-repeat-90d` (ratio): Of the customers whose very first order was in 2024, what share ordered again within 90 days of that first ord
- `ec-b-line-return-rate-2024-vs-2025` (ratio): What percentage of the items we sold in 2024 were later returned, and how does that compare with items sold in
- `ec-b-low-rating-share-yoy` (ratio): What share of our reviews gave 1 or 2 stars in 2026 so far, compared with 2025?
- `ec-b-biggest-mom-jump-2026` (ranking): In 2026, which month saw the biggest jump in number of orders compared with the month before?
- `ec-b-warehouse-stock-drop` (ranking): Which warehouse lost the most stock between the first and the latest stock count?
- `ec-b-promotions-running-on-date` (reasoning): Which promotions were running on 20 January 2025?
- `ec-b-ytd-2026-vs-2025` (reasoning): Is 2026 running ahead of or behind 2025 on number of orders?
- `ec-b-discount-vs-order-value` (reasoning): Do discounted orders end up bigger than orders without a discount?
- `ec-b-returns-by-top-category-2025` (join): Which main product department had the most returns in 2025?
- `ec-b-recent-sales-trend` (fuzzy-scope): How have sales been trending recently?
- `ec-b-returns-lately` (fuzzy-scope): Have returns been going up lately?
- `ec-b-ratings-lately` (fuzzy-scope): How have our product ratings been lately compared with before?
- `ec-c-quote-in-product-name` (encoding): Which products have a double quote character in their name, and what do they cost?
- `ec-c-legacy-closed-orders` (aggregate): How many legacy orders are closed?
- `ec-c-brazil-customers` (aggregate): How many customers are in Brazil?
- `ec-c-euro-orders` (aggregate): How many orders were placed in euros?
- `ec-c-discover-order-info` (discovery): What information is recorded about an order, from checkout to delivery?
- `ec-d-visual-monthly-orders-2025` (visual): Chart the number of orders we received each month of 2025.
- `ec-d-visual-returns-by-reason` (visual): Show me a chart of how many returns we had for each return reason.
- `ec-d-fedex-delivery-days-reworded` (paraphrase): What is the mean transit time in days for FedEx parcels, counting all the ways the carrier is written as one c
- `ec-d-cancel-rate-by-channel` (ratio): Which sales channel has the highest share of its orders cancelled, and what is that share? Count WEB, Web and 
- `ec-d-cancel-rate-by-channel-reworded` (paraphrase): Among our sales channels, where is the cancellation rate highest, and how high is it? Different capitalisation
- `ec-d-top-brands-units-reworded` (paraphrase): Name the three best-selling brands by number of units. Leave out cancelled orders and lines with a quantity of
