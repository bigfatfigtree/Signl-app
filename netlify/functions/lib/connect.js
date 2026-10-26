// Stripe Connect payout plumbing (Jeff, 2026-10-26: "we use
// stripe"). Phase 2 of the Stripe wiring: subscriptions live in
// lib/stripe.js; this module owns the paid lane's money movement.
//
// Model: creators are paid through Stripe Connect Express accounts
// (they never create a Stripe login of their own: onboarding is
// Stripe-hosted, reached from inside the app, and resumable).
// Businesses need NO Stripe account, ever: they keep a card on
// file with the platform (Checkout in setup mode), and a paid
// booking authorizes that card for the booking total (rate + 3%)
// with manual capture, so the money is HELD on the platform side
// at booking. When the existing escrow release fires (post proof
// submitted + the 48 hour hold), the authorization is captured and
// the creator's share (rate - 3%, they keep 97%) is transferred to
// their connected account; the platform keeps 6% total. If the
// visit never delivers, the authorization is cancelled before
// capture, which refunds the business in full and no transfer
// ever occurs.
//
// Gating: everything here sits behind the same env gate as
// billing (STRIPE_SECRET_KEY). With no key, connectConfigured()
// is false, every endpoint no-ops with a 503, bookings carry no
// funds object, and the paid lane keeps its recorded-ledger
// concierge behavior exactly as before. STRIPE_API_BASE (from
// lib/stripe.js) lets the verify suites point this at a fake
// Stripe HTTP server; production never sets it.

const stripe = require("./stripe");

function connectConfigured() {
  return stripe.billingConfigured();
}

// ---------- plain-language requirement labels ----------
// Stripe reports what's missing as dotted requirement codes
// (external_account, individual.id_number, ...). Creators never
// see the codes: they see what the thing IS.
const REQUIREMENT_LABELS = [
  [/external_account|bank_account/, "your bank account"],
  [/individual\.id_number|ssn_last_4|id_number/, "your ID number"],
  [/individual\.verification|verification\.document|document/, "an ID check"],
  [/individual\.dob/, "your date of birth"],
  [/individual\.address|address/, "your home address"],
  [/individual\.(first_name|last_name)/, "your legal name"],
  [/individual\.email/, "your email address"],
  [/individual\.phone/, "your phone number"],
  [/business_profile|product_description|mcc/, "a one-line description of what you do"],
  [/business_type/, "your business type"],
  [/tos_acceptance/, "accepting Stripe's terms"],
  [/company\./, "your business details"],
];
function plainRequirement(code) {
  const s = String(code || "");
  for (const [re, label] of REQUIREMENT_LABELS) if (re.test(s)) return label;
  return "a few more details";
}
function plainRequirements(account) {
  const req = (account && account.requirements) || {};
  const codes = [...(req.currently_due || []), ...(req.past_due || [])];
  const labels = [];
  for (const code of codes) {
    const label = plainRequirement(code);
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

// The one derivation of payout state from a Stripe account
// object (or its absence). Status words are ours, never
// Stripe's: not_started / pending / ready / restricted.
function payoutStateFromAccount(account) {
  if (!account || !account.id) return { status: "not_started", ready: false, missing: [] };
  const missing = plainRequirements(account);
  const disabled = account.requirements && account.requirements.disabled_reason;
  if (account.payouts_enabled && account.charges_enabled && missing.length === 0) {
    return { status: "ready", ready: true, missing: [] };
  }
  if (disabled) return { status: "restricted", ready: false, missing: missing.length ? missing : ["a few more details"] };
  return { status: "pending", ready: false, missing };
}

// ---------- Connect accounts (creators) ----------

async function createConnectedAccount(user) {
  return stripe.stripeApi("POST", "/v1/accounts", {
    type: "express",
    country: "US",
    email: user.email || undefined,
    capabilities: { transfers: { requested: true } },
    metadata: { signlUserId: user.id },
  });
}

async function getConnectedAccount(accountId) {
  return stripe.stripeApi("GET", `/v1/accounts/${encodeURIComponent(accountId)}`);
}

async function createAccountLink(accountId, refreshUrl, returnUrl) {
  const link = await stripe.stripeApi("POST", "/v1/account_links", {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return link && link.url;
}

// ---------- Business customers + cards ----------

async function createCustomer(biz) {
  return stripe.stripeApi("POST", "/v1/customers", {
    email: biz.email || undefined,
    name: (biz.business && biz.business.businessName) || biz.name || undefined,
    metadata: { signlBusinessId: biz.id },
  });
}

async function createCardSetupSession(biz, { customerId, successUrl, cancelUrl }) {
  return stripe.stripeApi("POST", "/v1/checkout/sessions", {
    mode: "setup",
    currency: "usd",
    customer: customerId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: biz.id,
    metadata: { businessId: biz.id, purpose: "card_on_file" },
  });
}

async function getSetupIntent(setupIntentId) {
  return stripe.stripeApi("GET", `/v1/setup_intents/${encodeURIComponent(setupIntentId)}`);
}

async function getPaymentMethod(paymentMethodId) {
  return stripe.stripeApi("GET", `/v1/payment_methods/${encodeURIComponent(paymentMethodId)}`);
}

function cardViewFromPaymentMethod(pm) {
  const card = (pm && pm.card) || {};
  return {
    brand: card.brand || "card",
    last4: card.last4 || "----",
    expMonth: card.exp_month || null,
    expYear: card.exp_year || null,
    paymentMethodId: pm ? pm.id : null,
  };
}

// ---------- Booking money movement ----------
// Amounts are integer cents everywhere inside Stripe; the
// booking ledger stays in dollars (paidMath) and converts at
// this boundary, so the two can never drift by a cent.

function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

async function createHeldCharge({ customerId, paymentMethodId, amountDollars, bookingId, businessId, creatorId }) {
  return stripe.stripeApi("POST", "/v1/payment_intents", {
    amount: toCents(amountDollars),
    currency: "usd",
    customer: customerId,
    payment_method: paymentMethodId,
    off_session: true,
    confirm: true,
    capture_method: "manual",
    metadata: { bookingId: bookingId || "", businessId: businessId || "", creatorId: creatorId || "" },
  });
}

async function getPaymentIntent(paymentIntentId) {
  return stripe.stripeApi("GET", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
}

async function captureHeldCharge(paymentIntentId) {
  return stripe.stripeApi("POST", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`, {});
}

async function cancelHeldCharge(paymentIntentId) {
  return stripe.stripeApi("POST", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, {});
}

async function refundPaymentIntent(paymentIntentId) {
  return stripe.stripeApi("POST", "/v1/refunds", { payment_intent: paymentIntentId });
}

async function createPayoutTransfer({ amountDollars, destinationAccountId, bookingId, creatorId }) {
  return stripe.stripeApi("POST", "/v1/transfers", {
    amount: toCents(amountDollars),
    currency: "usd",
    destination: destinationAccountId,
    transfer_group: bookingId ? `booking_${bookingId}` : undefined,
    metadata: { bookingId: bookingId || "", creatorId: creatorId || "" },
  });
}

module.exports = {
  connectConfigured,
  plainRequirement,
  plainRequirements,
  payoutStateFromAccount,
  createConnectedAccount,
  getConnectedAccount,
  createAccountLink,
  createCustomer,
  createCardSetupSession,
  getSetupIntent,
  getPaymentMethod,
  cardViewFromPaymentMethod,
  toCents,
  createHeldCharge,
  getPaymentIntent,
  captureHeldCharge,
  cancelHeldCharge,
  refundPaymentIntent,
  createPayoutTransfer,
};
