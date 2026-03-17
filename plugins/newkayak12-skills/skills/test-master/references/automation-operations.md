# Automation Operations

CI/CD pipeline integration, team enablement, ROI calculation, and reporting metrics.

## CI/CD Integration

### Complete Pipeline
```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1, 2, 3, 4]

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install --with-deps

      - run: npx playwright test --shard=${{ matrix.shard }}/4
        env:
          CI: true

      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: report-${{ matrix.shard }}
          path: playwright-report/
```

### Test Data Factories
```typescript
export class UserFactory {
  static create(overrides?: Partial<User>): User {
    return {
      id: faker.string.uuid(),
      email: faker.internet.email(),
      name: faker.person.fullName(),
      role: 'user',
      ...overrides,
    };
  }

  static createMany(count: number) {
    return Array.from({ length: count }, () => this.create());
  }
}

// Seed test data
test.beforeEach(async ({ page }) => {
  await page.request.post('/api/test/seed', {
    data: { users: UserFactory.createMany(10) },
  });
});
```

## Team Enablement

### Training Program
```markdown
**Week 1-2**: Framework basics, page objects, first test
**Week 3-4**: Data-driven, API integration, CI/CD
**Week 5-6**: Performance, error handling, scaling
**Ongoing**: Code reviews, knowledge sharing
```

### Code Review Checklist
```markdown
- [ ] Independent tests (no order dependency)
- [ ] Semantic locators (getByRole, getByLabel)
- [ ] Proper waits (no arbitrary timeouts)
- [ ] Error cases tested
- [ ] Test data cleanup
- [ ] Meaningful test names
- [ ] Page objects updated
```

## Automation Strategy

### ROI Calculation
```typescript
const manual = { timePerRun: 30, runsPerSprint: 10 };
const automation = { development: 120, maintenance: 5 };

const timeSaved = (manual.timePerRun * manual.runsPerSprint) - automation.maintenance;
const breakEven = Math.ceil(automation.development / timeSaved);
const annualSavings = (timeSaved * 26 - automation.development) / 60; // hours

// Example: Break-even in 1 sprint, save 110 hours/year
```

### Selection Criteria
```markdown
**Automate**: Repetitive, stable UI, critical paths, data-driven, positive ROI
**Don't Automate**: Exploratory, changing UI, one-time, usability, negative ROI
```

## Reporting & Metrics

### Custom Reporter
```typescript
class MetricsReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    this.sendMetrics({
      name: test.title,
      duration: result.duration,
      status: result.status,
      retries: result.retry,
    });
  }
}
```
