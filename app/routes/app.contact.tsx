import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type TawkWindow = { Tawk_API?: { toggle?: () => void } };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function ContactPage() {
  const handleLiveChat = () => {
    (window as unknown as TawkWindow).Tawk_API?.toggle?.();
  };

  return (
    <s-page heading="Contact Us">
      <s-section heading="Email">
        <s-stack direction="inline" gap="base" style={{ alignItems: "flex-start" }}>
          <s-icon type="email" tone="info" />
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Reach us anytime at{" "}
              <a href="mailto:support@asp-development.com" target="_top">
                support@asp-development.com
              </a>
              .
            </s-paragraph>
            <s-paragraph style={{ fontSize: "13px", color: "#6d7175" }}>
              Support hours: Mon–Fri 9am–5pm EST, Sat–Sun 9am–12pm EST.
            </s-paragraph>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Live chat">
        <s-stack direction="inline" gap="base" style={{ alignItems: "flex-start" }}>
          <s-icon type="chat" tone="info" />
          <s-stack direction="block" gap="base">
            <s-paragraph>Chat with us directly during support hours.</s-paragraph>
            <div>
              <s-button variant="primary" onClick={handleLiveChat}>
                Open Live Chat
              </s-button>
            </div>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (h) => boundary.headers(h);
