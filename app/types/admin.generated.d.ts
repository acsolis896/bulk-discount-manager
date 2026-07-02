/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.d.ts';

export type PopulateProductMutationVariables = AdminTypes.Exact<{
  product: AdminTypes.ProductCreateInput;
}>;


export type PopulateProductMutation = { productCreate?: AdminTypes.Maybe<{ product?: AdminTypes.Maybe<(
      Pick<AdminTypes.Product, 'id' | 'title' | 'handle' | 'status'>
      & { variants: { edges: Array<{ node: Pick<AdminTypes.ProductVariant, 'id' | 'price' | 'barcode' | 'createdAt'> }> }, demoInfo?: AdminTypes.Maybe<Pick<AdminTypes.Metafield, 'jsonValue'>> }
    )> }> };

export type ShopifyReactRouterTemplateUpdateVariantMutationVariables = AdminTypes.Exact<{
  productId: AdminTypes.Scalars['ID']['input'];
  variants: Array<AdminTypes.ProductVariantsBulkInput> | AdminTypes.ProductVariantsBulkInput;
}>;


export type ShopifyReactRouterTemplateUpdateVariantMutation = { productVariantsBulkUpdate?: AdminTypes.Maybe<{ productVariants?: AdminTypes.Maybe<Array<Pick<AdminTypes.ProductVariant, 'id' | 'price' | 'barcode' | 'createdAt'>>> }> };

export type ShopifyReactRouterTemplateUpsertMetaobjectMutationVariables = AdminTypes.Exact<{
  handle: AdminTypes.MetaobjectHandleInput;
  metaobject: AdminTypes.MetaobjectUpsertInput;
}>;


export type ShopifyReactRouterTemplateUpsertMetaobjectMutation = { metaobjectUpsert?: AdminTypes.Maybe<{ metaobject?: AdminTypes.Maybe<(
      Pick<AdminTypes.Metaobject, 'id' | 'handle'>
      & { title?: AdminTypes.Maybe<Pick<AdminTypes.MetaobjectField, 'jsonValue'>>, description?: AdminTypes.Maybe<Pick<AdminTypes.MetaobjectField, 'jsonValue'>> }
    )>, userErrors: Array<Pick<AdminTypes.MetaobjectUserError, 'field' | 'message'>> }> };

interface GeneratedQueryTypes {
}

interface GeneratedMutationTypes {
  "#graphql\n      mutation populateProduct($product: ProductCreateInput!) {\n        productCreate(product: $product) {\n          product {\n            id\n            title\n            handle\n            status\n            variants(first: 10) {\n              edges {\n                node {\n                  id\n                  price\n                  barcode\n                  createdAt\n                }\n              }\n            }\n            demoInfo: metafield(namespace: \"$app\", key: \"demo_info\") {\n              jsonValue\n            }\n          }\n        }\n      }": {return: PopulateProductMutation, variables: PopulateProductMutationVariables},
  "#graphql\n    mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {\n      productVariantsBulkUpdate(productId: $productId, variants: $variants) {\n        productVariants {\n          id\n          price\n          barcode\n          createdAt\n        }\n      }\n    }": {return: ShopifyReactRouterTemplateUpdateVariantMutation, variables: ShopifyReactRouterTemplateUpdateVariantMutationVariables},
  "#graphql\n    mutation shopifyReactRouterTemplateUpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {\n      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {\n        metaobject {\n          id\n          handle\n          title: field(key: \"title\") {\n            jsonValue\n          }\n          description: field(key: \"description\") {\n            jsonValue\n          }\n        }\n        userErrors {\n          field\n          message\n        }\n      }\n    }": {return: ShopifyReactRouterTemplateUpsertMetaobjectMutation, variables: ShopifyReactRouterTemplateUpsertMetaobjectMutationVariables},
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
