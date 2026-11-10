const app = document.querySelector("#app");
const state = { events: [], event: null, cart: null, checkout: null, buyer: null };
const details = {
  "evt-1": { name: "Friday Night Lights", venue: "Memorial Stadium", date: "2026-11-13T19:30:00-05:00", sport: "Football", accent: "#ffb703" },
  "evt-2": { name: "City Rivals Championship", venue: "Central Fieldhouse", date: "2026-11-20T18:00:00-05:00", sport: "Basketball", accent: "#fb7185" },
  "evt-3": { name: "Winter Classic", venue: "Northside Arena", date: "2026-12-05T16:00:00-05:00", sport: "Hockey", accent: "#38bdf8" },
};
const price = 2500;
const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const date = (value) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const enrich = (event) => ({ ...event, ...(details[event.id] || { name: event.id, venue: "Local venue", date: new Date().toISOString(), sport: "Live event", accent: "#ffb703" }) });

async function request(url, options) {
  const response = await fetch(url, options && { ...options, headers: { "content-type": "application/json", ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function home() {
  app.innerHTML = '<div class="loading">Loading events…</div>';
  state.events = (await request("/events")).map(enrich);
  app.innerHTML = `<section class="hero"><div><div class="eyebrow">Live events · instant tickets</div><h1>Find your seat in the crowd.</h1></div><p>Choose a local game, check out in a few steps, and receive your digital pass instantly.</p></section><section class="grid">${state.events.map((event) => `<article class="card"><div class="visual" style="--accent:${event.accent}"><span class="sport">${event.sport}</span><strong>${event.name}</strong></div><div class="card-body"><div class="meta"><span>◷ ${date(event.date)}</span><span>⌖ ${event.venue}</span><span>${event.remaining} tickets available</span></div><div class="price-row"><div class="price">${money(price)} <small>/ ticket</small></div><a class="button" href="#/event/${event.id}">Get tickets</a></div></div></article>`).join("")}</section>`;
}

async function checkout(id) {
  app.innerHTML = '<div class="loading">Loading event…</div>';
  state.event = enrich(await request(`/events/${id}`));
  app.innerHTML = `<a class="back" href="#/">← All events</a><div class="checkout"><section class="panel"><div class="eyebrow">Reserve tickets</div><h2>${state.event.name}</h2><form id="reserve" class="fields"><div class="field"><label for="name">Full name</label><input id="name" name="name" autocomplete="name"></div><div class="field"><label for="email">Email</label><input id="email" name="email" inputmode="email" autocomplete="email"></div><div class="field"><label for="quantity">Ticket quantity</label><select id="quantity" name="quantity">${[1,2,3,4,5,6,7,8].map((n) => `<option>${n}</option>`).join("")}</select></div><div id="error"></div><button>Continue to mock payment</button></form></section><aside class="panel summary"><h3>Order summary</h3><div class="summary-row"><span>Date</span><strong>${date(state.event.date)}</strong></div><div class="summary-row"><span>Venue</span><strong>${state.event.venue}</strong></div><div class="summary-row"><span>Available</span><strong>${state.event.remaining}</strong></div><div class="summary-row total"><span>Total</span><span id="total">${money(price)}</span></div></aside></div>`;
  document.querySelector("#quantity").addEventListener("change", ({ target }) => document.querySelector("#total").textContent = money(price * Number(target.value)));
  document.querySelector("#reserve").addEventListener("submit", reserve);
}

async function reserve(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button"); button.disabled = true; button.textContent = "Reserving…";
  try {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (!data.name.trim() || !data.email.includes("@")) throw new Error("Enter a valid name and email");
    state.buyer = { name: data.name.trim(), email: data.email.trim() };
    state.cart = await request("/carts", { method: "POST", body: JSON.stringify({ eventId: state.event.id, qty: Number(data.quantity) }) });
    state.checkout = await request("/checkouts", { method: "POST", body: JSON.stringify({ cartId: state.cart.cartId }) });
    payment();
  } catch (error) { showError(error); button.disabled = false; button.textContent = "Continue to mock payment"; }
}

function payment() {
  app.innerHTML = `<a class="back" href="#/event/${state.event.id}">← Back to details</a><div class="checkout"><section class="panel"><div class="eyebrow">Mock payment</div><h2>Complete your order</h2><div class="notice">No real card data is collected. This benchmark uses the built-in <strong>card-sandbox</strong> payment method.</div><form id="pay" class="fields" style="margin-top:18px"><div class="field"><label for="card">Mock card number</label><input id="card" name="cardNumber" inputmode="numeric" autocomplete="off" value="4242 4242 4242 4242"></div><div class="field"><label for="expiry">Expiry</label><input id="expiry" name="expiry" value="12/30" autocomplete="off"></div><div class="field"><label for="cvc">CVC</label><input id="cvc" name="cvc" value="123" inputmode="numeric" autocomplete="off"></div><div id="error"></div><button>Pay ${money(state.checkout.amountCents)}</button></form></section><aside class="panel summary"><h3>${state.event.name}</h3><div class="summary-row"><span>Tickets</span><strong>${state.cart.qty}</strong></div><div class="summary-row"><span>Buyer</span><strong>${state.buyer.name}</strong></div><div class="summary-row total"><span>Total</span><span>${money(state.checkout.amountCents)}</span></div></aside></div>`;
  document.querySelector("#pay").addEventListener("submit", pay);
}

async function pay(event) {
  event.preventDefault(); const button = event.currentTarget.querySelector("button"); button.disabled = true; button.textContent = "Processing…";
  try {
    const order = await request("/payments", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ checkoutId: state.checkout.checkoutId, method: "card-sandbox" }) });
    if (!order.orderId) throw new Error("Payment captured, but the order was not created");
    location.hash = `/order/${order.orderId}`;
  } catch (error) { showError(error); button.disabled = false; button.textContent = `Pay ${money(state.checkout.amountCents)}`; }
}

async function confirmation(id) {
  app.innerHTML = '<div class="loading">Confirming order…</div>';
  try {
    let order;
    for (let attempt = 0; attempt < 30; attempt++) {
      order = await request(`/orders/${id}`);
      if (order.status === "confirmed") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (order.status !== "confirmed") throw new Error("Order confirmation is taking longer than expected");
    const event = enrich(state.event?.id === order.eventId ? state.event : await request(`/events/${order.eventId}`));
    app.innerHTML = `<article class="ticket"><div class="ticket-top"><div class="success">✓ Payment complete</div><h1>You're going!</h1><p>${event.name}</p></div><div class="ticket-body"><div class="summary-row"><span>Order</span><strong>${order.orderId}</strong></div><div class="summary-row"><span>Date</span><strong>${date(event.date)}</strong></div><div class="summary-row"><span>Venue</span><strong>${event.venue}</strong></div><div class="summary-row"><span>Admission</span><strong>${order.qty} × General admission</strong></div><div class="code"><span>${order.ticketId}</span></div><a class="button wide" href="#/">Browse more events</a></div></article>`;
  } catch (error) { app.innerHTML = `<div class="error">${error.message}</div>`; }
}

function showError(error) { document.querySelector("#error").innerHTML = `<div class="error" role="alert">${error.message}</div>`; }
async function route() { const [, section, id] = location.hash.split("/"); try { if (section === "event" && id) return checkout(id); if (section === "order" && id) return confirmation(id); return home(); } catch (error) { app.innerHTML = `<div class="error">${error.message}</div>`; } }
addEventListener("hashchange", route); route();
