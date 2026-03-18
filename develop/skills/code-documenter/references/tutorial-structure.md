# Tutorial Structure & Step-by-Step Guides

## Progressive Learning Path

```markdown
# Getting Started with API

## Prerequisites
Before you begin, ensure you have:
- [ ] Node.js 18+ installed
- [ ] An API key from your dashboard
- [ ] Basic knowledge of REST APIs

## Quick Start (5 minutes)

### 1. Install the SDK
```bash
npm install @myapi/sdk
```

### 2. Create Your First Request
```typescript
import { Client } from '@myapi/sdk';

const client = new Client({ apiKey: 'your_key' });
const users = await client.users.list();
console.log(users);
```

### 3. Verify It Works
Run the code and you should see a list of users.

**Expected output:**
```json
{
  "data": [
    { "id": "1", "name": "Alice" },
    { "id": "2", "name": "Bob" }
  ],
  "total": 2
}
```

## Next Steps
- [Authentication Guide](/docs/auth) - Learn about OAuth and API keys
- [Advanced Queries](/docs/queries) - Filtering, sorting, pagination
- [Error Handling](/docs/errors) - Handle errors gracefully
```

## Step-by-Step Tutorial

```markdown
# Tutorial: Building a User Dashboard

**What you'll learn:**
- Fetching user data from the API
- Handling pagination
- Displaying data in a table
- Adding real-time updates

**Time:** 30 minutes
**Level:** Intermediate

## Step 1: Set Up the Project

Create a new project:
```bash
mkdir user-dashboard
cd user-dashboard
npm init -y
npm install @myapi/sdk react
```

## Step 2: Fetch Users

Create `src/api/users.ts`:
```typescript
import { Client } from '@myapi/sdk';

const client = new Client({ apiKey: process.env.API_KEY });

export async function getUsers(page = 1, limit = 20) {
  const response = await client.users.list({ page, limit });
  return response;
}
```

**What's happening:**
1. We import the SDK client
2. Initialize it with our API key from environment
3. Create a helper function that fetches paginated users

## Step 3: Create the Component

Create `src/components/UserTable.tsx`:
```typescript
import { useState, useEffect } from 'react';
import { getUsers } from '../api/users';

export function UserTable() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const data = await getUsers();
      setUsers(data.data);
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
        </tr>
      </thead>
      <tbody>
        {users.map(user => (
          <tr key={user.id}>
            <td>{user.name}</td>
            <td>{user.email}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Step 4: Test It

Run your app:
```bash
npm run dev
```

You should see a table with user data.

## Checkpoint
At this point, you have:
- [x] Set up the SDK
- [x] Created an API helper
- [x] Built a user table component
- [ ] Added pagination
- [ ] Added real-time updates

## Next: Adding Pagination

[Continue to Step 5 →](/docs/tutorial/step-5)
```

## Quick Reference

| Content Type | Best For | Key Elements |
|-------------|----------|-------------|
| Quick Start | New users (5 min) | Prerequisites, minimal code, verify |
| Tutorial | Learning by doing | Steps, checkpoints, working code |
| How-To Guide | Specific tasks | Goal, steps, troubleshooting |
| Reference | Looking up details | Comprehensive, searchable |
| Explanation | Understanding concepts | Why, not how |
