-- PLAN USAGE REPORT  (read only)
--
-- Shows how each shop uses the app, so you can see how many merchants a plan change would affect.
-- Run each numbered query on its own against the PRODUCTION database (Railway: Postgres service, Data tab).
-- It only reads. The results contain shop domains and counts: no customer data, no code values.
--
-- The "excluded" list in each query already ignores your own stores and Shopify's app-review test stores.
-- Add any other test store to that list (the same lines appear in all four queries).
--
-- LIMITS: reusable-code settings are mirrored in the database ("SingleCodeDiscount") and are counted here.
-- BULK-set settings (country rules, caps, tags, max items...) live only in Shopify and cannot be seen here;
-- for bulk sets this report only knows how many sets and codes exist.
-- "bulk_codes_unused_est" is an estimate: issued codes minus codes seen redeemed or imported as used.

-- 1) PER SHOP: one row per installed shop, biggest users first
WITH excluded(shop) AS (
  -- Stores to ignore: yours, plus Shopify's app-review test stores. Patterns use LIKE, so % matches anything.
  VALUES ('bdm-dev-store.myshopify.com'), ('jeweldre.myshopify.com'), ('bajio-dev-testing.myshopify.com'), ('app-review-%')
),
shops AS (
  SELECT DISTINCT s.shop FROM "Session" s WHERE NOT EXISTS (SELECT 1 FROM excluded e WHERE s.shop LIKE e.shop)
),
reusable AS (
  SELECT r.shop,
    COUNT(*) AS reusable_codes,
    COUNT(*) FILTER (WHERE r."usesPerCustomerLimit" IS NOT NULL) AS per_customer_limit,
    COUNT(*) FILTER (WHERE jsonb_typeof(r.cfg->'allowedCountries') = 'array'
                       AND jsonb_array_length(r.cfg->'allowedCountries') > 0) AS country_rules,
    COUNT(*) FILTER (WHERE r."eligibilityMode" IN ('tags', 'segment') OR r."requiredTag" <> ''
                       OR r."blockedTag" <> '' OR r."segmentId" IS NOT NULL) AS tag_or_segment,
    COUNT(*) FILTER (WHERE jsonb_exists(r.cfg, 'maxDiscountedItems')) AS max_items_discounted,
    COUNT(*) FILTER (WHERE jsonb_exists(r.cfg, 'maxCartItems')) AS max_cart_items,
    COUNT(*) FILTER (WHERE jsonb_exists(r.cfg, 'maxDiscountAmount')) AS discount_cap
  FROM (
    SELECT sc.*,
           CASE WHEN sc."configJson" IS NULL OR sc."configJson" = '' THEN NULL ELSE sc."configJson"::jsonb END AS cfg
    FROM "SingleCodeDiscount" sc
  ) r
  GROUP BY r.shop
),
bulk AS (
  SELECT ic.shop,
    COUNT(DISTINCT ic."discountId") AS bulk_sets,
    COUNT(*) AS bulk_codes_issued,
    -- a bulk code is "used" if an order redeemed it, or it was imported as already used
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "CodeRedemption" cr WHERE cr.shop = ic.shop AND cr.code = ic.code)
                        OR EXISTS (SELECT 1 FROM "PreUsedCode" pu WHERE pu.shop = ic.shop AND pu.code = ic.code)) AS bulk_codes_used
  FROM "IssuedCode" ic
  GROUP BY ic.shop
),
blocked AS (
  SELECT shop, COUNT(*) AS blocked_types FROM "BlockedProductType" GROUP BY shop
),
per_shop AS (
  SELECT sh.shop,
    COALESCE(re.reusable_codes, 0)        AS reusable_codes,
    COALESCE(bu.bulk_sets, 0)             AS bulk_sets,
    COALESCE(bu.bulk_codes_issued, 0)     AS bulk_codes_issued,
    GREATEST(COALESCE(bu.bulk_codes_issued, 0) - COALESCE(bu.bulk_codes_used, 0), 0) AS bulk_codes_unused_est,
    COALESCE(bl.blocked_types, 0)         AS blocked_types,
    COALESCE(re.per_customer_limit, 0)    AS reusable_with_per_customer_limit,
    COALESCE(re.country_rules, 0)         AS reusable_with_country_rules,
    COALESCE(re.tag_or_segment, 0)        AS reusable_with_tag_or_segment,
    COALESCE(re.max_items_discounted, 0)  AS reusable_with_max_items_discounted,
    COALESCE(re.max_cart_items, 0)        AS reusable_with_max_cart_items,
    COALESCE(re.discount_cap, 0)          AS reusable_with_discount_cap
  FROM shops sh
  LEFT JOIN reusable re ON re.shop = sh.shop
  LEFT JOIN bulk bu     ON bu.shop = sh.shop
  LEFT JOIN blocked bl  ON bl.shop = sh.shop
)
SELECT * FROM per_shop
ORDER BY reusable_codes + bulk_codes_unused_est DESC, shop;

-- 2) SUMMARY: how many shops a proposed Free-plan limit or feature gate would touch
WITH excluded(shop) AS (
  -- Stores to ignore: yours, plus Shopify's app-review test stores. Patterns use LIKE, so % matches anything.
  VALUES ('bdm-dev-store.myshopify.com'), ('jeweldre.myshopify.com'), ('bajio-dev-testing.myshopify.com'), ('app-review-%')
),
shops AS (
  SELECT DISTINCT s.shop FROM "Session" s WHERE NOT EXISTS (SELECT 1 FROM excluded e WHERE s.shop LIKE e.shop)
),
reusable AS (
  SELECT r.shop,
    COUNT(*) AS reusable_codes,
    COUNT(*) FILTER (WHERE r."usesPerCustomerLimit" IS NOT NULL) AS per_customer_limit,
    COUNT(*) FILTER (WHERE jsonb_typeof(r.cfg->'allowedCountries') = 'array'
                       AND jsonb_array_length(r.cfg->'allowedCountries') > 0) AS country_rules,
    COUNT(*) FILTER (WHERE r."eligibilityMode" IN ('tags', 'segment') OR r."requiredTag" <> ''
                       OR r."blockedTag" <> '' OR r."segmentId" IS NOT NULL) AS tag_or_segment,
    COUNT(*) FILTER (WHERE jsonb_exists(r.cfg, 'maxDiscountedItems')) AS max_items_discounted,
    COUNT(*) FILTER (WHERE jsonb_exists(r.cfg, 'maxCartItems')) AS max_cart_items,
    COUNT(*) FILTER (WHERE jsonb_exists(r.cfg, 'maxDiscountAmount')) AS discount_cap
  FROM (
    SELECT sc.*,
           CASE WHEN sc."configJson" IS NULL OR sc."configJson" = '' THEN NULL ELSE sc."configJson"::jsonb END AS cfg
    FROM "SingleCodeDiscount" sc
  ) r
  GROUP BY r.shop
),
bulk AS (
  SELECT ic.shop,
    COUNT(DISTINCT ic."discountId") AS bulk_sets,
    COUNT(*) AS bulk_codes_issued,
    -- a bulk code is "used" if an order redeemed it, or it was imported as already used
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "CodeRedemption" cr WHERE cr.shop = ic.shop AND cr.code = ic.code)
                        OR EXISTS (SELECT 1 FROM "PreUsedCode" pu WHERE pu.shop = ic.shop AND pu.code = ic.code)) AS bulk_codes_used
  FROM "IssuedCode" ic
  GROUP BY ic.shop
),
blocked AS (
  SELECT shop, COUNT(*) AS blocked_types FROM "BlockedProductType" GROUP BY shop
),
per_shop AS (
  SELECT sh.shop,
    COALESCE(re.reusable_codes, 0)        AS reusable_codes,
    COALESCE(bu.bulk_sets, 0)             AS bulk_sets,
    COALESCE(bu.bulk_codes_issued, 0)     AS bulk_codes_issued,
    GREATEST(COALESCE(bu.bulk_codes_issued, 0) - COALESCE(bu.bulk_codes_used, 0), 0) AS bulk_codes_unused_est,
    COALESCE(bl.blocked_types, 0)         AS blocked_types,
    COALESCE(re.per_customer_limit, 0)    AS reusable_with_per_customer_limit,
    COALESCE(re.country_rules, 0)         AS reusable_with_country_rules,
    COALESCE(re.tag_or_segment, 0)        AS reusable_with_tag_or_segment,
    COALESCE(re.max_items_discounted, 0)  AS reusable_with_max_items_discounted,
    COALESCE(re.max_cart_items, 0)        AS reusable_with_max_cart_items,
    COALESCE(re.discount_cap, 0)          AS reusable_with_discount_cap
  FROM shops sh
  LEFT JOIN reusable re ON re.shop = sh.shop
  LEFT JOIN bulk bu     ON bu.shop = sh.shop
  LEFT JOIN blocked bl  ON bl.shop = sh.shop
)
SELECT
  COUNT(*)                                                           AS installed_shops,
  COUNT(*) FILTER (WHERE reusable_codes > 0)                         AS shops_with_reusable_codes,
  COUNT(*) FILTER (WHERE reusable_codes > 2)                         AS shops_over_2_reusable,
  COUNT(*) FILTER (WHERE reusable_codes > 25)                        AS shops_over_25_reusable,
  COUNT(*) FILTER (WHERE bulk_codes_issued > 0)                      AS shops_with_bulk_sets,
  COUNT(*) FILTER (WHERE bulk_codes_unused_est > 10)                 AS shops_over_10_unused_bulk_today,
  COUNT(*) FILTER (WHERE bulk_codes_unused_est > 100)                AS shops_over_100_unused_bulk,
  COUNT(*) FILTER (WHERE bulk_codes_unused_est > 1000)               AS shops_over_1000_unused_bulk,
  COUNT(*) FILTER (WHERE blocked_types > 1)                          AS shops_with_2plus_blocked_types,
  COUNT(*) FILTER (WHERE reusable_with_per_customer_limit > 0)       AS shops_using_per_customer_limits,
  COUNT(*) FILTER (WHERE reusable_with_country_rules > 0)            AS shops_using_country_rules,
  COUNT(*) FILTER (WHERE reusable_with_tag_or_segment > 0)           AS shops_using_tag_or_segment,
  COUNT(*) FILTER (WHERE reusable_with_max_items_discounted > 0)     AS shops_using_max_items_discounted,
  COUNT(*) FILTER (WHERE reusable_with_max_cart_items > 0)           AS shops_using_max_cart_items,
  COUNT(*) FILTER (WHERE reusable_with_discount_cap > 0)             AS shops_using_discount_cap
FROM per_shop;

-- 3) LARGE BULK SETS: sets that would be over a proposed bulk limit (here 100 codes)
WITH excluded(shop) AS (
  -- Stores to ignore: yours, plus Shopify's app-review test stores (LIKE patterns, % matches anything)
  VALUES ('bdm-dev-store.myshopify.com'), ('jeweldre.myshopify.com'), ('bajio-dev-testing.myshopify.com'), ('app-review-%')
)
SELECT ic.shop, ic."discountId", COUNT(*) AS codes_in_set, MIN(ic."createdAt")::date AS first_code_created
FROM "IssuedCode" ic
WHERE NOT EXISTS (SELECT 1 FROM excluded e WHERE ic.shop LIKE e.shop)
GROUP BY ic.shop, ic."discountId"
HAVING COUNT(*) > 100
ORDER BY codes_in_set DESC;

-- 4) BLOCKED PRODUCT TYPES per shop (a proposed Free plan allows 1)
WITH excluded(shop) AS (
  -- Stores to ignore: yours, plus Shopify's app-review test stores (LIKE patterns, % matches anything)
  VALUES ('bdm-dev-store.myshopify.com'), ('jeweldre.myshopify.com'), ('bajio-dev-testing.myshopify.com'), ('app-review-%')
)
SELECT bpt.shop, COUNT(*) AS blocked_product_types, string_agg(bpt."productType", ', ' ORDER BY bpt."productType") AS types
FROM "BlockedProductType" bpt
WHERE NOT EXISTS (SELECT 1 FROM excluded e WHERE bpt.shop LIKE e.shop)
GROUP BY bpt.shop
ORDER BY blocked_product_types DESC;
