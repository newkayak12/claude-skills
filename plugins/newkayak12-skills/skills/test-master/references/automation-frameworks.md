# Automation Frameworks

## Advanced Framework Patterns

### Screenplay Pattern
```typescript
// Better separation of concerns than POM
export class Actor {
  constructor(private page: Page) {}
  attemptsTo(...tasks: Task[]) {
    return Promise.all(tasks.map(t => t.performAs(this)));
  }
}

class Login implements Task {
  constructor(private email: string, private password: string) {}
  async performAs(actor: Actor) {
    await actor.page.getByLabel('Email').fill(this.email);
    await actor.page.getByLabel('Password').fill(this.password);
    await actor.page.getByRole('button', { name: 'Login' }).click();
  }
}

// Clear, maintainable test code
await new Actor(page).attemptsTo(new Login('user@test.com', 'pass'));
```

### Keyword-Driven Testing
```typescript
const keywords = {
  NAVIGATE: (page, url) => page.goto(url),
  CLICK: (page, selector) => page.click(selector),
  TYPE: (page, selector, text) => page.fill(selector, text),
  VERIFY: (page, selector) => expect(page.locator(selector)).toBeVisible(),
};

// Data drives execution - ideal for non-technical authors
const steps = [
  { keyword: 'NAVIGATE', args: ['/login'] },
  { keyword: 'TYPE', args: ['#email', 'user@test.com'] },
  { keyword: 'CLICK', args: ['#submit'] },
];

for (const step of steps) await keywords[step.keyword](page, ...step.args);
```

### Model-Based Testing
```typescript
// State machine defines valid transitions
const cartModel = {
  empty: { addItem: 'hasItems' },
  hasItems: { addItem: 'hasItems', removeItem: 'hasItems|empty', checkout: 'checkingOut' },
  checkingOut: { confirm: 'complete', cancel: 'hasItems' },
};

// Generate comprehensive test paths automatically
const testPaths = generatePathsFromModel(cartModel);
```

## Maintenance Strategies

### Self-Healing Locators
```typescript
// Multi-strategy finder with automatic fallback
async function findElement(page: Page, strategies: string[]): Promise<Locator> {
  for (const selector of strategies) {
    const el = page.locator(selector);
    if (await el.count() > 0) return el;
  }
  throw new Error(`Not found: ${strategies.join(', ')}`);
}

// Usage: tries best -> good -> fallback
const submit = await findElement(page, [
  '[data-testid="submit"]',     // Best: stable test ID
  'button:has-text("Submit")',  // Good: semantic
  'button.primary',             // Fallback: CSS
]);
```

### Error Recovery & Smart Retry
```typescript
// Auto-retry with recovery actions
async function clickWithRecovery(page: Page, selector: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.click(selector, { timeout: 5000 });
      return;
    } catch (e) {
      if (i === retries - 1) throw e;
      await page.reload();
      await page.waitForLoadState('networkidle');
    }
  }
}

// Exponential backoff for flaky operations
async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}
```

## Scaling Strategies

### Parallel & Distributed Execution
```typescript
// playwright.config.ts
export default defineConfig({
  workers: process.env.CI ? 8 : 4,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,

  // Shard tests across multiple machines
  shard: process.env.SHARD ? {
    current: parseInt(process.env.SHARD_INDEX),
    total: parseInt(process.env.SHARD_TOTAL),
  } : undefined,
});
```

```yaml
# GitHub Actions: distribute across 5 workers
strategy:
  matrix:
    shard: [1, 2, 3, 4, 5]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/5
```

### Resource Optimization
```typescript
// Reuse browser contexts for faster execution
let browser: Browser;
let context: BrowserContext;

test.beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext();
});

test('test 1', async () => {
  const page = await context.newPage();
  // Test logic
  await page.close();
});

test.afterAll(async () => {
  await context.close();
  await browser.close();
});
```

## Quick Reference

| Pattern | Best For | Complexity |
|---------|----------|-----------|
| Page Object | Reusable components | Medium |
| Screenplay | Complex workflows | High |
| Keyword-Driven | Non-tech testers | Low |
| Model-Based | State machines | High |

| Scaling | Use Case |
|---------|----------|
| Parallel | Reduce time |
| Distributed | Large suites |
| Cloud | Cross-browser |
| Resource Reuse | Speed |

| Tool | Category |
|------|----------|
| Playwright, Cypress | Web E2E |
| Appium, Detox | Mobile |
| k6, Gatling | Performance |
