import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useNavigate, useNavigation } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

const TAWK_PROPERTY_ID = "6a98490aef935f3443550c67";
const TAWK_WIDGET_ID = "1k1hdqkhp";

type TawkWindow = { Tawk_API?: { toggle?: () => void } };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  // Shopify's s-link updates the host-frame URL via history.pushState without
  // triggering a React Router navigation. Intercept pushState to sync them.
  useEffect(() => {
    const orig = window.history.pushState.bind(window.history);
    window.history.pushState = function (state, title, url) {
      orig(state, title, url);
      if (url && typeof url === "string") {
        const path = url.startsWith("http") ? new URL(url).pathname : url;
        navigate(path, { replace: true });
      }
    };
    return () => {
      window.history.pushState = orig;
    };
  }, [navigate]);

  // Load the Tawk.to support chat widget once per page load.
  useEffect(() => {
    if ((window as unknown as TawkWindow).Tawk_API) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://embed.tawk.to/${TAWK_PROPERTY_ID}/${TAWK_WIDGET_ID}`;
    script.charset = "UTF-8";
    script.setAttribute("crossorigin", "*");
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript?.parentNode?.insertBefore(script, firstScript);
  }, []);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/discounts/new">Create bulk discounts</s-link>
        <s-link href="/app/single-codes/new">Create reusable codes</s-link>
        <s-link href="/app/additional">Discount sets</s-link>
        <s-link href="/app/settings">Rules</s-link>
        <s-link href="/app/plans">Plans</s-link>
        <s-link href="/app/contact">Contact Us</s-link>
      </s-app-nav>
      {isLoading ? (
        <s-page heading="Loading…">
          <s-section heading="">
            <s-paragraph>Loading…</s-paragraph>
          </s-section>
        </s-page>
      ) : (
        <Outlet />
      )}
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
