import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // A request to "/" with no shop param but a referer from our own app's
  // origin is a client-side navigation from inside an already-embedded
  // session (confirmed via logging — Shopify's own redirects always carry
  // the shop/host/embedded params, so this only happens for in-app soft
  // navigations that lost them). Send those into the embedded app instead
  // of showing the manual login form, which is only meant for a genuine,
  // un-embedded first visit.
  const referer = request.headers.get("referer");
  let refererOrigin: string | null = null;
  try {
    refererOrigin = referer ? new URL(referer).origin : null;
  } catch {
    refererOrigin = null;
  }
  if (refererOrigin === url.origin) {
    throw redirect("/app");
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Discount Codes & Rules</h1>
        <p className={styles.text}>
          Create bulk and single-use discount codes, and control which items and
          combinations are allowed at checkout.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}
