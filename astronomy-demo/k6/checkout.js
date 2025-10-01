import http from 'k6/http';
import { check, sleep } from 'k6';

// Env vars
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const RATE = Number(__ENV.CHECKOUT_RATE_PER_SEC || 2); // requests per second
const DURATION = __ENV.TEST_DURATION || '10m';

export const options = {
  scenarios: {
    steady_checkout: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(10, RATE * 2),
      maxVUs: Math.max(50, RATE * 4),
      tags: { service: 'checkout', route: '/api/checkout' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.03'],
  },
};

export default function () {
  // Minimal flow: add-to-cart then checkout endpoint
  // Adjust endpoints to match your frontend/cart routes
  const headers = { 'Content-Type': 'application/json' };

  // Add to cart
  const addRes = http.post(`${BASE_URL}/api/cart`, JSON.stringify({ productId: 'extreme-astronomy-binoculars', quantity: 1 }), { headers });
  check(addRes, {
    'add-to-cart status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  // Checkout
  const payload = {
    email: 'demo@example.com',
    address: {
      street: '1 Space Way', city: 'Andromeda', state: 'OT', zip: '424242', country: 'US',
    },
    creditCard: {
      number: '4111111111111111', ccv: '737', expMonth: 12, expYear: 2030,
    },
  };
  const res = http.post(`${BASE_URL}/api/checkout`, JSON.stringify(payload), { headers });
  check(res, {
    'checkout status is 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
  });

  sleep(0.5);
}

