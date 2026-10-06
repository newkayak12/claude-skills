# End-to-End Tests

An E2E test drives the deployed system the way a user does. It is slow and the most failure-prone layer, so spend it only on journeys whose breakage costs money or trust.

## Choosing journeys

Rank candidate flows by (business impact x chance of breaking). Typical keepers: sign-up and login, the purchase or submission path, payment, and one recovery path (password reset). Anything checkable lower down -- validation messages, calculations, permutations -- belongs in unit or integration tests.

Target a small suite (tens, not hundreds) that runs in minutes.

## Writing stable browser tests (Playwright)

- Locate by role, label or a dedicated `data-testid`, not by CSS chains or text that marketing may change.
- Rely on auto-waiting and web-first assertions (`await expect(locator).toBeVisible()`); do not insert fixed sleeps.
- One test = one journey with a clear end state; keep steps inside it linear.
- Each test creates its own account/data through an API or seed endpoint, and does not depend on another test having run.
- Log in once through the API and reuse the saved storage state instead of walking the login form in every test.

```ts
test('buyer completes checkout', async ({ page, request }) => {
  const { sku } = await seedProduct(request, { stock: 1 });
  await page.goto(`/products/${sku}`);
  await page.getByRole('button', { name: 'Add to basket' }).click();
  await page.getByRole('link', { name: 'Checkout' }).click();
  await payWithTestCard(page);
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
});
```

## Data and environment

- Use a dedicated environment with test-mode third parties (payment sandbox, mail catcher).
- Make seeded data unique per run (random suffix) so parallel workers do not collide.
- Clean up through the API, or let the environment be rebuilt on a schedule.

## Browsers and devices

Run the full suite on one engine for every change; add the other engines and a mobile viewport nightly or before release.

## Diagnosing failures

Keep a trace, screenshot and video on first retry. A test that passes only on retry is a defect in the test or the product; track the retry rate and fix the worst offenders weekly.
