import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useNavigate, useNavigation } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

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

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Create discount set</s-link>
        <s-link href="/app/additional">Discount sets</s-link>
        <s-link href="/app/settings">Rules</s-link>
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
