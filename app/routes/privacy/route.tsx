import styles from "./styles.module.css";

export default function PrivacyPolicy() {
  return (
    <div className={styles.wrapper}>
      <h1>Privacy Policy</h1>
      <p className={styles.updated}>Effective date: July 13, 2026</p>

      <p>
        Discount Codes &amp; Rules ("the App") is a Shopify app that helps merchants
        create bulk and reusable discount codes and control which items and
        combinations are allowed at checkout. This policy explains what data the
        App collects, how it's used, and how it's handled.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Store information:</strong> your shop domain and an access
          token issued by Shopify when you install the App, used to make API
          calls on your behalf.
        </li>
        <li>
          <strong>Discount configuration data:</strong> the titles, codes,
          percentages, eligible products/collections, and blocked product
          types you configure through the App.
        </li>
        <li>
          <strong>Customer identifiers only:</strong> when you use the
          reusable-code eligibility feature, the App stores Shopify customer
          ID references (e.g. <code>gid://shopify/Customer/123</code>) to
          build discount eligibility segments. We do not store customer
          names, email addresses, phone numbers, or physical addresses.
        </li>
        <li>
          <strong>Staff account information:</strong> if you access the App's
          embedded interface, Shopify's standard authentication may share
          basic staff account details (such as name and email) with the App
          as part of session verification. This is provided by Shopify, not
          collected directly by us.
        </li>
      </ul>

      <p>
        We do not collect or store payment or financial information. Billing
        for paid plans is handled entirely by Shopify's Billing API — we only
        receive confirmation of your subscription status.
      </p>

      <h2>How we use this information</h2>
      <p>
        Data is used solely to provide the App's functionality: creating and
        managing discount codes, enforcing checkout-time discount rules, and
        computing customer eligibility for reusable codes. We do not sell
        this data or share it with third parties for marketing purposes.
      </p>

      <h2>Service providers</h2>
      <p>
        We use the following third-party services to operate the App:
      </p>
      <ul>
        <li><strong>Shopify</strong> — the e-commerce platform this App is built on.</li>
        <li><strong>Railway</strong> — hosting infrastructure and database storage.</li>
      </ul>

      <h2>Data retention and deletion</h2>
      <p>
        We retain shop data for as long as the App is installed on your
        store. When you uninstall the App, we automatically delete stored
        shop data, including session tokens, discount configuration records,
        and reusable code eligibility data. We also honor Shopify's mandatory
        privacy webhooks:
      </p>
      <ul>
        <li>
          <strong>Customer data requests</strong> — we do not store customer
          PII, so no additional data beyond what Shopify itself provides
          exists to disclose.
        </li>
        <li>
          <strong>Customer redaction</strong> — we remove the requested
          customer's ID from any discount eligibility lists we maintain.
        </li>
        <li>
          <strong>Shop redaction</strong> — we permanently delete all
          remaining data associated with your shop.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Data is transmitted over encrypted (HTTPS) connections. Access
        tokens and shop data are stored in a private database that is not
        directly accessible to the public.
      </p>

      <h2>Cookies</h2>
      <p>
        As an embedded Shopify app, we rely on Shopify's session token
        authentication rather than persistent third-party tracking cookies.
        Cookies set by Shopify itself are governed by{" "}
        <a href="https://www.shopify.com/legal/privacy" target="_blank" rel="noreferrer">
          Shopify's own privacy policy
        </a>.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Changes will be posted
        on this page with an updated effective date.
      </p>

      <h2>Contact us</h2>
      <p>
        If you have questions about this policy or how your data is
        handled, contact us at{" "}
        <a href="mailto:acsolis896@gmail.com">acsolis896@gmail.com</a>.
      </p>
    </div>
  );
}
